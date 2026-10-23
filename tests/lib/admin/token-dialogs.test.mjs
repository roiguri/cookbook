import { jest } from '@jest/globals';
import {
  askToRevokeToken,
  cancelRevokeQuestion,
  showTokenSecretOnce,
  SECRET_CLEAR_DELAY_MS,
} from '../../../src/lib/admin/api-tokens/token-dialogs.js';

const afterFade = () => new Promise((r) => setTimeout(r, SECRET_CLEAR_DELAY_MS + 20));

// Stand-ins with the parts of <confirmation-modal> / <custom-modal> the helpers use.
function fakeConfirmationModal() {
  const modal = document.createElement('div');
  modal.confirm = jest.fn();
  modal.approve = () => modal.dispatchEvent(new CustomEvent('confirm-approved'));
  modal.reject = () => modal.dispatchEvent(new CustomEvent('confirm-rejected'));
  return modal;
}
function fakeCustomModal() {
  const modal = document.createElement('div');
  modal.isOpen = false;
  modal.open = jest.fn(() => {
    modal.isOpen = true;
  });
  modal.setCloseGuard = (fn) => {
    modal._guard = fn;
  };
  modal.clearCloseGuard = () => {
    modal._guard = null;
  };
  modal.close = async ({ byUser = false } = {}) => {
    if (byUser && modal._guard && !(await modal._guard())) return;
    modal.isOpen = false;
    modal.dispatchEvent(new CustomEvent('modal-closed'));
  };
  document.body.append(modal);
  return modal;
}

afterEach(() => {
  cancelRevokeQuestion();
  document.body.replaceChildren();
});

describe('askToRevokeToken', () => {
  it('revokes on approve, and names the token', () => {
    const modal = fakeConfirmationModal();
    const revoke = jest.fn();
    askToRevokeToken(modal, { name: 'Jarvis' }, revoke);
    expect(modal.confirm.mock.calls[0][0]).toContain('"Jarvis"');
    modal.approve();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('does nothing on reject, and a later approve of nothing revokes nothing', () => {
    const modal = fakeConfirmationModal();
    const revoke = jest.fn();
    askToRevokeToken(modal, { name: 'A' }, revoke);
    modal.reject();
    modal.approve();
    expect(revoke).not.toHaveBeenCalled();
  });

  it('a dismissed question never fires: approving the next one revokes only that token', () => {
    const modal = fakeConfirmationModal();
    const revokeA = jest.fn();
    const revokeB = jest.fn();
    askToRevokeToken(modal, { name: 'A' }, revokeA); // dismissed: no answer
    askToRevokeToken(modal, { name: 'B' }, revokeB);
    modal.approve();
    expect(revokeA).not.toHaveBeenCalled();
    expect(revokeB).toHaveBeenCalledTimes(1);
  });

  it('answers once: a second approve after the first does nothing', () => {
    const modal = fakeConfirmationModal();
    const revoke = jest.fn();
    askToRevokeToken(modal, { name: 'A' }, revoke);
    modal.approve();
    modal.approve();
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('cancelRevokeQuestion drops an open question (page unmount)', () => {
    const modal = fakeConfirmationModal();
    const revoke = jest.fn();
    askToRevokeToken(modal, { name: 'A' }, revoke);
    cancelRevokeQuestion();
    modal.approve();
    expect(revoke).not.toHaveBeenCalled();
  });
});

describe('showTokenSecretOnce', () => {
  const show = (modal) =>
    showTokenSecretOnce(modal, { secret: 'ckb_SECRET', token: { name: 'Jarvis' } });

  it('shows the secret left-to-right and opens the modal', () => {
    const modal = fakeCustomModal();
    show(modal);
    const field = modal.querySelector('input');
    expect(field.value).toBe('ckb_SECRET');
    expect(field.dir).toBe('ltr');
    expect(field.readOnly).toBe(true);
    expect(modal.open).toHaveBeenCalled();
  });

  it('warns once before closing an uncopied secret, then closes and removes it', async () => {
    const modal = fakeCustomModal();
    show(modal);
    await modal.close({ byUser: true });
    expect(modal.isOpen).toBe(true);
    expect(modal.querySelector('.api-token-secret__not-copied').hidden).toBe(false);

    await modal.close({ byUser: true });
    expect(modal.isOpen).toBe(false);
    expect(modal._guard).toBeNull();
    // Still visible while the modal fades out, then removed.
    expect(modal.querySelector('input')).not.toBeNull();
    await afterFade();
    expect(modal.innerHTML).toBe('');
  });

  it('does not wipe a new secret shown during the previous fade-out', async () => {
    const modal = fakeCustomModal();
    show(modal);
    modal.querySelector('input').dispatchEvent(new Event('copy'));
    await modal.close({ byUser: true });
    showTokenSecretOnce(modal, { secret: 'ckb_NEXT', token: { name: 'Next' } });
    await afterFade();
    expect(modal.querySelector('input').value).toBe('ckb_NEXT');
  });

  it('closes straight away once copied', async () => {
    const modal = fakeCustomModal();
    Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue() } });
    show(modal);
    modal.querySelector('.api-token-secret__copy').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ckb_SECRET');
    await modal.close({ byUser: true });
    expect(modal.isOpen).toBe(false);
    await afterFade();
    expect(modal.querySelector('input')).toBeNull();
  });

  it('counts a manual copy, and "done" goes through the same guard', async () => {
    const modal = fakeCustomModal();
    show(modal);
    modal.querySelector('input').dispatchEvent(new Event('copy'));
    modal.querySelector('.api-token-secret__done').click();
    await Promise.resolve();
    await Promise.resolve();
    expect(modal.isOpen).toBe(false);
  });
});
