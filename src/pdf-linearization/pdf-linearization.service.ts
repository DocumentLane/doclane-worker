import { execFile } from 'node:child_process';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PdfLinearizationResult } from './interfaces/pdf-linearization-result.interface';

const execFileAsync = promisify(execFile);

interface QdfObject {
  start: number;
  end: number;
  id: number;
  bodyStart: number;
  bodyEnd: number;
  body?: string;
}

interface PageTreeGroup {
  id: number;
  refs: number[];
}

interface QpdfPagesJson {
  pages?: Array<{
    object?: string;
    pageposfrom1?: number;
  }>;
}

type PageAttributes = Partial<
  Record<(typeof INHERITABLE_PAGE_KEYS)[number], string>
>;

const INHERITABLE_PAGE_KEYS = [
  'Resources',
  'MediaBox',
  'CropBox',
  'Rotate',
] as const;

@Injectable()
export class PdfLinearizationService {
  private readonly logger = new Logger(PdfLinearizationService.name);

  constructor(private readonly configService: ConfigService) {}

  async linearize(pdfBytes: Uint8Array): Promise<PdfLinearizationResult> {
    if (
      !this.configService.getOrThrow<boolean>(
        'pdfProcessing.linearization.enabled',
      )
    ) {
      return {
        bytes: pdfBytes,
        linearized: false,
        sizeBytes: pdfBytes.byteLength,
      };
    }

    const qpdfPath = this.configService.getOrThrow<string>(
      'pdfProcessing.linearization.qpdfPath',
    );
    const fixQdfPath = this.configService.getOrThrow<string>(
      'pdfProcessing.linearization.fixQdfPath',
    );
    const required = this.configService.getOrThrow<boolean>(
      'pdfProcessing.linearization.required',
    );
    const rebalancePageTreeEnabled = this.configService.getOrThrow<boolean>(
      'pdfProcessing.linearization.rebalancePageTreeEnabled',
    );
    const pageTreeGroupSize = this.configService.getOrThrow<number>(
      'pdfProcessing.linearization.pageTreeGroupSize',
    );
    const workdir = await mkdtemp(join(tmpdir(), 'doclane-pdf-linearize-'));
    const inputPath = join(workdir, 'input.pdf');
    const qdfPath = join(workdir, 'input.qdf.pdf');
    const balancedQdfPath = join(workdir, 'balanced.qdf.pdf');
    const fixedQdfPath = join(workdir, 'balanced.fixed.qdf.pdf');
    const balancedPdfPath = join(workdir, 'balanced.pdf');
    const outputPath = join(workdir, 'output.pdf');

    try {
      await writeFile(inputPath, pdfBytes);

      if (rebalancePageTreeEnabled) {
        await execFileAsync(qpdfPath, [
          '--qdf',
          '--object-streams=disable',
          inputPath,
          qdfPath,
        ]);
        await this.rebalanceQdfPageTree({
          inputPath: qdfPath,
          outputPath: balancedQdfPath,
          groupSize: pageTreeGroupSize,
          qpdfPath,
        });
        await execFileAsync(fixQdfPath, [balancedQdfPath, fixedQdfPath]);
        await execFileAsync(qpdfPath, [fixedQdfPath, balancedPdfPath]);
        await execFileAsync(qpdfPath, [
          '--linearize',
          '--object-streams=generate',
          balancedPdfPath,
          outputPath,
        ]);
      } else {
        await execFileAsync(qpdfPath, ['--linearize', inputPath, outputPath]);
      }

      await execFileAsync(qpdfPath, ['--check', outputPath]);
      await execFileAsync(qpdfPath, ['--check-linearization', outputPath]);
      const outputBytes = await readFile(outputPath);

      return {
        bytes: new Uint8Array(outputBytes),
        linearized: true,
        sizeBytes: outputBytes.byteLength,
      };
    } catch (error) {
      if (required) {
        throw error;
      }

      const errorMessage = this.getErrorMessage(error);

      this.logger.warn(`PDF linearization skipped. ${errorMessage}`);

      return {
        bytes: pdfBytes,
        linearized: false,
        errorMessage,
        sizeBytes: pdfBytes.byteLength,
      };
    } finally {
      await rm(workdir, { recursive: true, force: true });
    }
  }

  private async rebalanceQdfPageTree(params: {
    inputPath: string;
    outputPath: string;
    groupSize: number;
    qpdfPath: string;
  }): Promise<void> {
    if (!Number.isInteger(params.groupSize) || params.groupSize < 2) {
      throw new Error('PDF page tree group size must be an integer >= 2.');
    }

    const qdfBytes = await readFile(params.inputPath);
    const objects = this.parseQdfObjects(qdfBytes);
    const objectById = new Map(objects.map((object) => [object.id, object]));
    const catalog = objects.find((object) =>
      this.objectContains(qdfBytes, object, '/Type /Catalog'),
    );

    if (!catalog) {
      throw new Error('PDF catalog object was not found.');
    }

    const pagesRootId = this.readRequiredObjectRef(
      this.readObjectBody(qdfBytes, catalog),
      '/Pages',
    );
    const pageIds = await this.readPageIdsFromQpdfJson({
      qpdfPath: params.qpdfPath,
      inputPath: params.inputPath,
    });
    const inheritedAttributesByPageId = this.collectInheritedPageAttributes(
      pagesRootId,
      objectById,
      qdfBytes,
    );

    if (pageIds.length === 0) {
      throw new Error('PDF page tree does not contain any pages.');
    }

    let nextObjectId =
      objects.reduce((maxId, object) => Math.max(maxId, object.id), 0) + 1;
    const groups: PageTreeGroup[] = [];

    for (let index = 0; index < pageIds.length; index += params.groupSize) {
      groups.push({
        id: nextObjectId++,
        refs: pageIds.slice(index, index + params.groupSize),
      });
    }

    const replacements = new Map<number, string>();
    replacements.set(
      pagesRootId,
      this.createPagesObjectBody({
        count: pageIds.length,
        kids: groups.map((group) => group.id),
      }),
    );

    for (const group of groups) {
      for (const pageId of group.refs) {
        const page = objectById.get(pageId);

        if (!page) {
          throw new Error(`PDF page object ${pageId} was not found.`);
        }

        replacements.set(
          pageId,
          this.replacePageParent(
            this.materializeInheritedPageAttributes({
              body: this.readObjectBody(qdfBytes, page),
              inheritedAttributes:
                inheritedAttributesByPageId.get(pageId) ?? {},
            }),
            group.id,
          ),
        );
      }
    }

    const appendedObjects = groups
      .map(
        (group) =>
          `\n%% Page tree rebalance group\n${group.id} 0 obj\n${this.createPagesObjectBody(
            {
              count: group.refs.length,
              kids: group.refs,
              parentId: pagesRootId,
            },
          )}\nendobj\n`,
      )
      .join('');

    await this.writeRebalancedQdf({
      qdfBytes,
      objects,
      replacements,
      appendedObjects,
      size: nextObjectId,
      outputPath: params.outputPath,
    });
  }

  private parseQdfObjects(qdfBytes: Buffer): QdfObject[] {
    const objects: QdfObject[] = [];
    const objectHeaderSuffix = Buffer.from(' 0 obj\n', 'latin1');
    const endObjectMarker = Buffer.from('\nendobj', 'latin1');
    let searchOffset = 0;

    while (searchOffset < qdfBytes.length) {
      const suffixIndex = qdfBytes.indexOf(objectHeaderSuffix, searchOffset);

      if (suffixIndex < 0) {
        break;
      }

      const lineStart = this.findPreviousNewline(qdfBytes, suffixIndex - 1) + 1;
      const objectIdText = qdfBytes
        .subarray(lineStart, suffixIndex)
        .toString('latin1');

      if (!/^\d+$/.test(objectIdText)) {
        searchOffset = suffixIndex + objectHeaderSuffix.length;
        continue;
      }

      const bodyStart = suffixIndex + objectHeaderSuffix.length;
      const bodyEnd = qdfBytes.indexOf(endObjectMarker, bodyStart);

      if (bodyEnd < 0) {
        throw new Error(`PDF QDF object ${objectIdText} is not terminated.`);
      }

      objects.push({
        start: lineStart,
        end: bodyEnd + endObjectMarker.length,
        id: Number(objectIdText),
        bodyStart,
        bodyEnd,
      });

      searchOffset = bodyEnd + endObjectMarker.length;
    }

    return objects;
  }

  private findPreviousNewline(bytes: Buffer, offset: number): number {
    for (let index = offset; index >= 0; index -= 1) {
      if (bytes[index] === 0x0a) {
        return index;
      }
    }

    return -1;
  }

  private objectContains(
    qdfBytes: Buffer,
    object: QdfObject,
    value: string,
  ): boolean {
    const index = qdfBytes.indexOf(
      Buffer.from(value, 'latin1'),
      object.bodyStart,
    );

    return index >= object.bodyStart && index < object.bodyEnd;
  }

  private readObjectBody(qdfBytes: Buffer, object: QdfObject): string {
    object.body ??= qdfBytes
      .subarray(object.bodyStart, object.bodyEnd)
      .toString('latin1');

    return object.body;
  }

  private async readPageIdsFromQpdfJson(params: {
    qpdfPath: string;
    inputPath: string;
  }): Promise<number[]> {
    const { stdout } = await execFileAsync(
      params.qpdfPath,
      [
        '--json',
        '--json-stream-data=none',
        '--json-key=pages',
        params.inputPath,
      ],
      {
        maxBuffer: 1024 * 1024 * 50,
      },
    );
    const parsed = JSON.parse(stdout) as QpdfPagesJson;

    if (!Array.isArray(parsed.pages)) {
      throw new Error('qpdf JSON output does not contain a pages array.');
    }

    return parsed.pages
      .sort(
        (left, right) => (left.pageposfrom1 ?? 0) - (right.pageposfrom1 ?? 0),
      )
      .map((page) => {
        const match = /^(\d+)\s+0\s+R$/.exec(page.object ?? '');

        if (!match) {
          throw new Error(
            'qpdf JSON page entry does not contain a page object.',
          );
        }

        return Number(match[1]);
      });
  }

  private collectInheritedPageAttributes(
    rootId: number,
    objectById: Map<number, QdfObject>,
    qdfBytes: Buffer,
  ): Map<number, PageAttributes> {
    const inheritedAttributesByPageId = new Map<number, PageAttributes>();
    const visit = (
      objectId: number,
      inheritedAttributes: PageAttributes,
    ): void => {
      const object = objectById.get(objectId);

      if (!object) {
        throw new Error(`PDF page tree object ${objectId} was not found.`);
      }

      const body = this.readObjectBody(qdfBytes, object);

      if (/\/Type\s+\/Page\b/.test(body)) {
        inheritedAttributesByPageId.set(objectId, inheritedAttributes);
        return;
      }

      if (!/\/Type\s+\/Pages\b/.test(body)) {
        throw new Error(`PDF page tree object ${objectId} is not a page node.`);
      }

      const nextInheritedAttributes = {
        ...inheritedAttributes,
        ...this.readInheritablePageAttributes(body),
      };

      for (const kidId of this.readKidsObjectRefs(body)) {
        visit(kidId, nextInheritedAttributes);
      }
    };

    visit(rootId, {});
    return inheritedAttributesByPageId;
  }

  private readRequiredObjectRef(body: string, key: string): number {
    const match = new RegExp(
      `${this.escapeRegExp(key)}\\s+(\\d+)\\s+0\\s+R`,
    ).exec(body);

    if (!match) {
      throw new Error(`Required PDF object reference ${key} was not found.`);
    }

    return Number(match[1]);
  }

  private readKidsObjectRefs(body: string): number[] {
    const match = /\/Kids\s+\[([\s\S]*?)\]/.exec(body);

    if (!match) {
      throw new Error('PDF page tree node does not have a /Kids array.');
    }

    return [...match[1].matchAll(/(\d+)\s+0\s+R/g)].map((ref) =>
      Number(ref[1]),
    );
  }

  private readInheritablePageAttributes(body: string): PageAttributes {
    return Object.fromEntries(
      INHERITABLE_PAGE_KEYS.flatMap((key) => {
        const value = this.readTopLevelDictionaryValue(body, key);

        return value === undefined ? [] : [[key, value]];
      }),
    );
  }

  private materializeInheritedPageAttributes(params: {
    body: string;
    inheritedAttributes: PageAttributes;
  }): string {
    let body = params.body;

    for (const key of INHERITABLE_PAGE_KEYS) {
      if (
        params.inheritedAttributes[key] &&
        this.readTopLevelDictionaryValue(body, key) === undefined
      ) {
        body = body.replace(
          /\n\s*\/Type\s+\/Page\b/,
          `\n  /${key} ${params.inheritedAttributes[key]}\n  /Type /Page`,
        );
      }
    }

    return body;
  }

  private replacePageParent(body: string, parentId: number): string {
    const replaced = body.replace(
      /\/Parent\s+\d+\s+0\s+R/,
      `/Parent ${parentId} 0 R`,
    );

    if (replaced === body) {
      throw new Error('PDF page object does not have a replaceable /Parent.');
    }

    return replaced;
  }

  private readTopLevelDictionaryValue(
    body: string,
    key: string,
  ): string | undefined {
    const keyPattern = `/${key}`;
    let index = body.indexOf(keyPattern);

    while (index >= 0) {
      const previous = body[index - 1];
      const next = body[index + keyPattern.length];

      if (
        (!previous || /\s|<|\[/.test(previous)) &&
        (!next || /\s|<|\[|\//.test(next))
      ) {
        return this.readDictionaryValueAt(body, index + keyPattern.length);
      }

      index = body.indexOf(keyPattern, index + keyPattern.length);
    }

    return undefined;
  }

  private readDictionaryValueAt(body: string, valueStart: number): string {
    let cursor = valueStart;

    while (cursor < body.length && /\s/.test(body[cursor])) {
      cursor += 1;
    }

    const start = cursor;

    if (body.startsWith('<<', cursor)) {
      return body.slice(start, this.findBalancedEnd(body, cursor, '<<', '>>'));
    }

    if (body[cursor] === '[') {
      return body.slice(start, this.findBalancedEnd(body, cursor, '[', ']'));
    }

    while (cursor < body.length && !/\s/.test(body[cursor])) {
      cursor += 1;
    }

    const firstTokenEnd = cursor;

    while (cursor < body.length && /\s/.test(body[cursor])) {
      cursor += 1;
    }

    const secondTokenStart = cursor;
    while (cursor < body.length && !/\s/.test(body[cursor])) {
      cursor += 1;
    }

    const secondToken = body.slice(secondTokenStart, cursor);

    while (cursor < body.length && /\s/.test(body[cursor])) {
      cursor += 1;
    }

    if (/^\d+$/.test(body.slice(start, firstTokenEnd)) && secondToken === '0') {
      const thirdTokenStart = cursor;

      while (cursor < body.length && !/\s/.test(body[cursor])) {
        cursor += 1;
      }

      if (body.slice(thirdTokenStart, cursor) === 'R') {
        return body.slice(start, cursor);
      }
    }

    return body.slice(start, firstTokenEnd);
  }

  private findBalancedEnd(
    body: string,
    start: number,
    openToken: string,
    closeToken: string,
  ): number {
    let cursor = start;
    let depth = 0;

    while (cursor < body.length) {
      if (body.startsWith(openToken, cursor)) {
        depth += 1;
        cursor += openToken.length;
        continue;
      }

      if (body.startsWith(closeToken, cursor)) {
        depth -= 1;
        cursor += closeToken.length;

        if (depth === 0) {
          return cursor;
        }

        continue;
      }

      cursor += 1;
    }

    throw new Error('PDF dictionary value is not balanced.');
  }

  private createPagesObjectBody(params: {
    count: number;
    kids: number[];
    parentId?: number;
  }): string {
    const kids = params.kids.map((id) => `    ${id} 0 R`).join('\n');
    const parent = params.parentId ? `  /Parent ${params.parentId} 0 R\n` : '';

    return `<<\n  /Count ${params.count}\n  /Kids [\n${kids}\n  ]\n${parent}  /Type /Pages\n>>`;
  }

  private async writeRebalancedQdf(params: {
    qdfBytes: Buffer;
    objects: QdfObject[];
    replacements: Map<number, string>;
    appendedObjects: string;
    size: number;
    outputPath: string;
  }): Promise<void> {
    const output = await open(params.outputPath, 'w');
    let cursor = 0;

    try {
      for (const object of params.objects) {
        await this.writeBufferSlice(
          output,
          params.qdfBytes,
          cursor,
          object.start,
        );
        if (params.replacements.has(object.id)) {
          await output.writeFile(
            `${object.id} 0 obj\n${params.replacements.get(object.id)}\nendobj`,
            'latin1',
          );
        } else {
          await this.writeBufferSlice(
            output,
            params.qdfBytes,
            object.start,
            object.end,
          );
        }
        cursor = object.end;
      }

      const xrefIndex = params.qdfBytes.indexOf(
        Buffer.from('\nxref\n', 'latin1'),
        cursor,
      );

      if (xrefIndex < 0) {
        throw new Error('PDF QDF xref table was not found.');
      }

      await this.writeBufferSlice(output, params.qdfBytes, cursor, xrefIndex);
      await output.writeFile(params.appendedObjects, 'latin1');
      await output.writeFile(
        params.qdfBytes
          .subarray(xrefIndex)
          .toString('latin1')
          .replace(/\/Size\s+\d+/, `/Size ${params.size}`),
        'latin1',
      );
    } finally {
      await output.close();
    }
  }

  private async writeBufferSlice(
    output: Awaited<ReturnType<typeof open>>,
    bytes: Buffer,
    start: number,
    end: number,
  ): Promise<void> {
    const chunkSize = 1024 * 1024 * 8;

    for (let offset = start; offset < end; offset += chunkSize) {
      await output.writeFile(
        bytes.subarray(offset, Math.min(offset + chunkSize, end)),
      );
    }
  }

  private escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return 'Unknown linearization error.';
  }
}
