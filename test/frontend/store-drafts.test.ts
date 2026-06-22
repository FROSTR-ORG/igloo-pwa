import { describe, expect, it } from 'vitest';

import { createDefaultState } from '@/lib/store-hydrate';
import { setDraftFormField, setDraftSecretField } from '@/lib/store-drafts';

// These pin the two generic reducers the store's updateXForm/updateXPassword
// methods delegate to: a single field of one plain draft form, and a single
// scalar `draftSecrets` field. Both must be immutable (return a new state +
// new nested objects) and must not touch any sibling field.

describe('setDraftFormField', () => {
  it('sets a single field on the named draft form', () => {
    const base = createDefaultState();
    const next = setDraftFormField(base, 'profileForm', 'label', 'My Device');
    expect(next.drafts.profileForm.label).toBe('My Device');
    // sibling field in the same form is untouched
    expect(next.drafts.profileForm.relayUrls).toBe(base.drafts.profileForm.relayUrls);
  });

  it('does not mutate the input state or its nested drafts', () => {
    const base = createDefaultState();
    const next = setDraftFormField(base, 'importProfileForm', 'profileString', 'bfp1...');
    expect(base.drafts.importProfileForm.profileString).toBe('');
    expect(next).not.toBe(base);
    expect(next.drafts).not.toBe(base.drafts);
    expect(next.drafts.importProfileForm).not.toBe(base.drafts.importProfileForm);
  });

  it('leaves other draft forms and the secrets partition alone', () => {
    const base = createDefaultState();
    const next = setDraftFormField(base, 'onboardConnectForm', 'packageText', 'pkg');
    expect(next.drafts.onboardSaveForm).toBe(base.drafts.onboardSaveForm);
    expect(next.draftSecrets).toBe(base.draftSecrets);
  });
});

describe('setDraftSecretField', () => {
  it('sets a single scalar secret field', () => {
    const base = createDefaultState();
    const next = setDraftSecretField(base, 'importProfileFormPassword', 'hunter2');
    expect(next.draftSecrets.importProfileFormPassword).toBe('hunter2');
  });

  it('routes a password/confirm selection to the chosen key only', () => {
    const base = createDefaultState();
    // Mirror the updateXPassword call site: the concrete key is selected from
    // the 'password' | 'confirmPassword' field before the reducer is called.
    const setPair = (field: 'password' | 'confirmPassword', value: string) =>
      setDraftSecretField(
        base,
        field === 'password' ? 'profileFormPassword' : 'profileFormConfirm',
        value,
      );
    const next = setPair('confirmPassword', 'secret');
    expect(next.draftSecrets.profileFormConfirm).toBe('secret');
    expect(next.draftSecrets.profileFormPassword).toBe('');
  });

  it('does not mutate the input state or its secrets, and leaves drafts alone', () => {
    const base = createDefaultState();
    const next = setDraftSecretField(base, 'onboardConnectFormPassword', 'pw');
    expect(base.draftSecrets.onboardConnectFormPassword).toBe('');
    expect(next).not.toBe(base);
    expect(next.draftSecrets).not.toBe(base.draftSecrets);
    expect(next.drafts).toBe(base.drafts);
  });
});
