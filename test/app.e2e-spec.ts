import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from './../src/app.module';

describe('Worker app (e2e)', () => {
  let moduleFixture: TestingModule;

  beforeEach(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
  });

  afterEach(async () => {
    await moduleFixture.close();
  });

  it('bootstraps the worker module', () => {
    expect(moduleFixture).toBeDefined();
  });
});
