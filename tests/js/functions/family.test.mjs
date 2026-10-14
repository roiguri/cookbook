import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { familyMembers } = require('../../../functions/utils/family.js');

describe('familyMembers', () => {
  const users = [
    { id: 'me', data: { role: 'approved', fullName: 'Me Myself' } },
    {
      id: 'u1',
      data: { role: 'approved', fullName: 'נועה מזרחי', email: 'n@x.test', avatarUrl: 'a.png' },
    },
    { id: 'u2', data: { role: 'manager', fullName: 'אבי לוי' } },
    { id: 'u3', data: { role: 'user', fullName: 'Plain User' } },
    { id: 'u4', data: { role: 'approved', displayName: '  ' } },
    { id: 'u5', data: {} },
  ];

  it('lists approved family and managers, without the caller', () => {
    expect(familyMembers(users, 'me').map((m) => m.uid)).toEqual(['u2', 'u1', 'u4']);
  });

  it('returns only name and avatar', () => {
    expect(familyMembers(users, 'me')[1]).toEqual({
      uid: 'u1',
      name: 'נועה מזרחי',
      avatarUrl: 'a.png',
    });
  });

  it('keeps people without a name, last', () => {
    expect(familyMembers(users, 'me')[2]).toEqual({ uid: 'u4', name: null, avatarUrl: null });
  });
});
