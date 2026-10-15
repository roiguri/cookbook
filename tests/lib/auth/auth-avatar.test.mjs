import { jest } from '@jest/globals';

let avatarUrl = null;
jest.unstable_mockModule('src/js/services/auth/auth-service.js', () => ({
  default: {
    getCurrentAvatarUrl: () => avatarUrl,
    addAuthObserver: () => {},
    getCurrentUser: () => null,
  },
}));
jest.unstable_mockModule('src/lib/auth/components/auth-content.js', () => ({}));

beforeAll(async () => {
  await import('src/lib/auth/components/auth-avatar.js');
});

const BUILT = 'https://cdn/o/user-avatars%2Fu1.png?alt=media&token=t&v=1';
const STOCK = 'https://cdn/o/Avatars%2F02-man.svg?alt=media&token=t';

function mount() {
  const el = document.createElement('auth-avatar');
  document.body.appendChild(el);
  return { el, trigger: () => el.shadowRoot.getElementById('auth-trigger') };
}

afterEach(() => {
  document.body.innerHTML = '';
  avatarUrl = null;
});

describe('<auth-avatar>', () => {
  it('shows a built avatar without the stock zoom ("built")', () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    expect(trigger().classList.contains('built')).toBe(true);
    expect(trigger().querySelector('img').getAttribute('src')).toBe(BUILT);
  });

  it('signing out after a built avatar shows the signed-out icon on the green circle', () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    el.updateAvatar(null);
    expect(trigger().classList.contains('signed-out')).toBe(true);
    // 'built' paints a white background, which would hide the white icon
    expect(trigger().classList.contains('built')).toBe(false);
    expect(trigger().querySelector('svg')).not.toBeNull();
  });

  it('switching to a user with a stock avatar or initials drops "built"', () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    avatarUrl = STOCK;
    el.updateAvatar({ email: 'a@b.c' });
    expect(trigger().classList.contains('built')).toBe(false);
    avatarUrl = null;
    el.updateAvatar({ email: 'z@b.c' });
    expect(trigger().classList.contains('built')).toBe(false);
    expect(trigger().textContent).toContain('Z');
  });
});
