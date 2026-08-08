import { validate } from 'class-validator';
import { CreateProjectDto } from './create-project.dto';

describe('CreateProjectDto', () => {
  it('accepts a local HTTP API URL with an explicit port', async () => {
    const dto = Object.assign(new CreateProjectDto(), {
      name: 'Local API',
      baseUrl: 'http://localhost:8000',
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects non-HTTP protocols', async () => {
    const dto = Object.assign(new CreateProjectDto(), {
      name: 'Local API',
      baseUrl: 'ftp://localhost:8000',
    });

    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'baseUrl')).toBe(true);
  });
});
