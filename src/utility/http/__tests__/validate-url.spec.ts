import { isValidHttpUrl } from '../validate-url.js';

describe('URL Validator', () => {
  it('return null on missing-protocol URL', () => {
    const url = 'abc.com';

    expect(isValidHttpUrl(url)).toEqual(null);
  });

  it('return the URL on valid input URL', () => {
    const sptPubUrl = 'https://api-h-c7818b61-608.sptpub.com';

    expect(isValidHttpUrl(sptPubUrl)).toEqual(sptPubUrl + '/');
  });
});
