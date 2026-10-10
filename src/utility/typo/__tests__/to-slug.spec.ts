import { toSlug } from '../to-slug.js';

describe('To Slug', () => {
  it.each([
    {
      data: 'Hello, World!! 2024',
      expectation: 'hello-world-2024',
    },
    {
      data: '   Javascript with             so many space           .',
      expectation: 'javascript-with-so-many-space',
    },
    {
      data: '   Đây là một câu từ Tiếng Việt              kinh khủng',
      expectation: 'day-la-mot-cau-tu-tieng-viet-kinh-khung',
    },
  ])(
    'must return lowered hyphenated non-alphanumeric string, tested data is: $data',
    ({ data, expectation }) => {
      const string = data;

      const transformedString = toSlug(string);

      expect(transformedString).toEqual(expectation);
    },
  );
});
