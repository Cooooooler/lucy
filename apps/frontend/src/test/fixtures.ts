import type { User } from '../api/types';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: '1',
    username: 'alice',
    email: 'alice@example.com',
    nickname: null,
    status: 1,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}
