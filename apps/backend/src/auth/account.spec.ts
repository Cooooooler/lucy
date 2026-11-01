import { isEmailAccount } from './account.js';

describe('isEmailAccount', () => {
  it.each([
    ['alice@example.com', true],
    ['alice', false],
    ['alice@team', true],
  ])('%s → %s', (account, expected) => {
    expect(isEmailAccount(account)).toBe(expected);
  });
});
