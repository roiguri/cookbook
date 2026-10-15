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
  // jsdom doesn't load images: let every picture "load" (or fail, per test).
  HTMLImageElement.prototype.decode = function decode() {
    return imageLoads ? Promise.resolve() : Promise.reject(new Error('load failed'));
  };
  await import('src/lib/auth/components/auth-avatar.js');
});

let imageLoads = true;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

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
  imageLoads = true;
});

describe('<auth-avatar>', () => {
  it('shows a built avatar without the stock zoom ("built")', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    expect(trigger().classList.contains('built')).toBe(true);
    expect(trigger().querySelector('img').getAttribute('src')).toBe(BUILT);
  });

  it('signing out after a built avatar shows the signed-out icon on the green circle', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    el.updateAvatar(null);
    expect(trigger().classList.contains('signed-out')).toBe(true);
    // 'built' paints a white background, which would hide the white icon
    expect(trigger().classList.contains('built')).toBe(false);
    expect(trigger().querySelector('svg')).not.toBeNull();
  });

  it('switching to a user with a stock avatar or initials drops "built"', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    avatarUrl = STOCK;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    expect(trigger().classList.contains('built')).toBe(false);
    avatarUrl = null;
    el.updateAvatar({ email: 'z@b.c' });
    expect(trigger().classList.contains('built')).toBe(false);
    expect(trigger().textContent).toContain('Z');
  });

  it('only pictures get the search-bar border; the green circle stays borderless', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    expect(trigger().classList.contains('photo')).toBe(true);
    el.updateAvatar(null);
    expect(trigger().classList.contains('photo')).toBe(false);
    avatarUrl = null;
    el.updateAvatar({ email: 'a@b.c' });
    expect(trigger().classList.contains('photo')).toBe(false);
  });

  it('keeps the current icon (pending) until the new picture loads: no empty circle', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    // Not loaded yet: still the signed-out icon, with the pending ring, no white background.
    expect(trigger().classList.contains('pending')).toBe(true);
    expect(trigger().querySelector('svg')).not.toBeNull();
    expect(trigger().classList.contains('built')).toBe(false);
    await settle();
    expect(trigger().classList.contains('pending')).toBe(false);
    expect(trigger().querySelector('img')).not.toBeNull();
  });

  it('falls back to the initial if the picture fails to load', async () => {
    const { el, trigger } = mount();
    imageLoads = false;
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'q@b.c' });
    await settle();
    expect(trigger().querySelector('img')).toBeNull();
    expect(trigger().textContent).toContain('Q');
    expect(trigger().classList.contains('pending')).toBe(false);
  });

  it('does not redraw when nothing changed (no repeated fades)', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    const img = trigger().querySelector('img');
    el.updateAvatar({ email: 'a@b.c' });
    await settle();
    expect(trigger().querySelector('img')).toBe(img);
  });

  it('a sign-out during a slow picture load wins', async () => {
    const { el, trigger } = mount();
    avatarUrl = BUILT;
    el.updateAvatar({ email: 'a@b.c' });
    el.updateAvatar(null); // before the picture arrived
    await settle();
    expect(trigger().classList.contains('signed-out')).toBe(true);
    expect(trigger().querySelector('img')).toBeNull();
  });
});
