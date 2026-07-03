import type { Dispatch, SetStateAction } from 'react';
import type { PolicyOverrideValue } from 'igloo-shared';

import * as adapter from './local-adapter';
import type { SessionController } from './session-controller';
import {
  clearGlobalState,
  clearSessionState,
  deleteProfileGlobal,
} from './storage';
import {
  createDefaultDraftSecrets,
  createDefaultState,
} from './store-hydrate';
import type {
  PwaPersistedState,
  PwaProfile,
  PwaRuntimeSnapshot,
  PwaSettings,
  PwaSignerSettings,
} from './types';

function mergeRuntimeProfile(
  current: PwaPersistedState,
  runtimeSnapshot: PwaRuntimeSnapshot | null,
): PwaProfile[] {
  return runtimeSnapshot?.profile == null
    ? current.profiles
    : current.profiles.map((profile) =>
        profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
      );
}

function routeToLandingAfterSignerExit(
  current: PwaPersistedState,
  runtimeSnapshot: PwaRuntimeSnapshot | null,
): PwaPersistedState {
  return {
    ...current,
    profiles: mergeRuntimeProfile(current, runtimeSnapshot),
    peerPermissionStates: adapter.defaultPeerPermissionStates(),
    runtimeWarning: null,
    dashboardLoadError: null,
    runtimeSnapshot: null,
    activeView: 'landing',
    activeDashboardTab: 'signer',
    unlockPassphrase: '',
    draftSecrets: createDefaultDraftSecrets(),
  };
}

export type StoreDashboardActions = {
  copyProfilePackage: (profileId: string, format: 'bfprofile' | 'bfshare') => Promise<void>;
  exportEncryptedPackage: (
    profileId: string,
    format: 'bfprofile' | 'bfshare',
    exportPassword: string,
  ) => Promise<string>;
  deleteProfile: (profileId: string) => void;
  updatePeerPolicy: (
    pubkey: string,
    direction: 'request' | 'respond',
    method: 'ping' | 'onboard' | 'sign' | 'ecdh',
    value: PolicyOverrideValue
  ) => Promise<void>;
  resolveApproval: (requestId: string, approved: boolean) => Promise<void>;
  clearPeerPolicies: () => Promise<void>;
  clearLogs: () => Promise<void>;
  startSigner: () => Promise<void>;
  stopSigner: () => Promise<void>;
  refreshSigner: () => Promise<void>;
  pingPeer: (pubkey: string) => Promise<void>;
  saveOperatorSettings: (input: {
    label: string;
    relays: string[];
    signerSettings: PwaSignerSettings;
  }) => Promise<void>;
  logout: () => Promise<void>;
  clearDeviceCredentials: () => Promise<void>;
  updateSettings: (field: keyof PwaSettings, checked: boolean) => void;
};

export function createDashboardActions({
  controller,
  getState,
  getSelectedProfile,
  setState,
}: {
  controller: SessionController;
  getState: () => PwaPersistedState;
  getSelectedProfile: () => PwaProfile | null;
  setState: Dispatch<SetStateAction<PwaPersistedState>>;
}): StoreDashboardActions {
  return {
    async copyProfilePackage(profileId, format) {
      const snapshot = getState();
      const profile = snapshot.profiles.find((entry) => entry.id === profileId);
      if (!profile) return;
      const transientPackageText = format === 'bfprofile' ? profile.profile_string : profile.share_string;
      const packageText = transientPackageText?.trim()
        ? transientPackageText
        : await adapter.exportEncryptedPackage({
            profile,
            storedPassword: snapshot.unlockPassphrase,
            exportPassword: snapshot.unlockPassphrase,
            format,
          });
      if (!packageText.trim()) {
        throw new Error(`No ${format} package is available for this profile.`);
      }
      if (!navigator.clipboard?.writeText) {
        throw new Error('Clipboard access is unavailable in this browser.');
      }
      await navigator.clipboard.writeText(packageText);
    },
    async exportEncryptedPackage(profileId, format, exportPassword) {
      const snapshot = getState();
      const profile = snapshot.profiles.find((entry) => entry.id === profileId);
      if (!profile) {
        throw new Error('Select a profile first.');
      }
      if (!profile.profile_string?.trim() && !profile.encrypted_bfshare_artifact?.trim()) {
        throw new Error('No package is available to export for this profile.');
      }
      return await adapter.exportEncryptedPackage({
        profile,
        storedPassword: snapshot.unlockPassphrase,
        exportPassword,
        format,
      });
    },
    deleteProfile(profileId) {
      void adapter.disposeRuntimeSessionForProfile(profileId, controller);
      // Remove from the shared store explicitly (read-filter-write): the
      // debounced global persistor merges by id and would otherwise resurrect
      // a profile that is still on disk but absent from the new state.
      deleteProfileGlobal(profileId);
      setState((current) => ({
        ...current,
        profiles: current.profiles.filter((entry) => entry.id !== profileId),
        runtimeWarning:
          current.selectedProfileId === profileId ? null : current.runtimeWarning,
        selectedProfileId:
          current.selectedProfileId === profileId
            ? current.profiles.find((entry) => entry.id !== profileId)?.id ?? ''
            : current.selectedProfileId,
        runtimeSnapshot:
          current.runtimeSnapshot?.profile?.id === profileId ? null : current.runtimeSnapshot,
      }));
    },
    async updatePeerPolicy(pubkey, direction, method, value) {
      const snapshot = getState();
      const runtimeSnapshot = await adapter.applyPeerPolicy(
        snapshot.runtimeSnapshot,
        pubkey,
        direction,
        method,
        value,
        controller,
      );
      // D.4: null return = session drift. Leave state untouched —
      // the UI retains whatever runtimeSnapshot it last saw rather
      // than surfacing a thrown error.
      if (!runtimeSnapshot) return;
      setState((current) => ({
        ...current,
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        runtimeWarning: null,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        runtimeSnapshot,
      }));
    },
    async resolveApproval(requestId, approved) {
      const snapshot = getState();
      await adapter.resolveApproval(snapshot.runtimeSnapshot, requestId, approved, controller);
    },
    async clearPeerPolicies() {
      const snapshot = getState();
      const runtimeSnapshot = await adapter.clearPeerPolicies(snapshot.runtimeSnapshot, controller);
      if (!runtimeSnapshot) return;
      setState((current) => ({
        ...current,
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        runtimeWarning: null,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        runtimeSnapshot,
      }));
    },
    async clearLogs() {
      const snapshot = getState();
      const runtimeSnapshot = await adapter.clearSessionLogs(snapshot.runtimeSnapshot, controller);
      // Idempotent on snapshot/live-session drift: leave state untouched.
      if (!runtimeSnapshot) return;
      setState((current) => ({
        ...current,
        runtimeWarning: null,
        runtimeSnapshot,
      }));
    },
    async startSigner() {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) return;
      if (!snapshot.unlockPassphrase.trim()) {
        throw new Error('Enter the device passphrase to start the signer.');
      }
      let runtimeSnapshot: PwaRuntimeSnapshot;
      try {
        runtimeSnapshot = await adapter.startSession(selectedProfile, snapshot.unlockPassphrase, controller);
      } catch (error) {
        // A hard start/restore failure leaves no runtime to query, so surface
        // it as the full-panel load-failed screen on the dashboard (Retry /
        // Clear) rather than only a transient toast.
        const message = error instanceof Error && error.message.trim() ? error.message : 'Failed to start the signer.';
        setState((current) => ({
          ...current,
          dashboardLoadError: { message, at: Math.floor(Date.now() / 1000) },
          activeView: 'dashboard',
          activeDashboardTab: 'signer',
        }));
        throw error;
      }
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? adapter.defaultPeerPermissionStates(),
        runtimeWarning: null,
        dashboardLoadError: null,
        runtimeSnapshot,
        activeView: 'dashboard',
        activeDashboardTab: 'signer',
      }));
    },
    async stopSigner() {
      const snapshot = getState();
      let runtimeSnapshot: PwaRuntimeSnapshot | null = null;
      try {
        runtimeSnapshot = await adapter.stopSession(snapshot.runtimeSnapshot, controller);
      } catch {
        await adapter.disposeRuntimeSessionForProfile(
          snapshot.runtimeSnapshot?.profile?.id,
          controller,
        ).catch(() => undefined);
        runtimeSnapshot = null;
      }
      setState((current) => routeToLandingAfterSignerExit(current, runtimeSnapshot));
    },
    async refreshSigner() {
      const snapshot = getState();
      let runtimeSnapshot: PwaRuntimeSnapshot | null = null;
      try {
        runtimeSnapshot = await adapter.refreshSession(snapshot.runtimeSnapshot, controller);
      } catch {
        await adapter.disposeRuntimeSessionForProfile(
          snapshot.runtimeSnapshot?.profile?.id,
          controller,
        ).catch(() => undefined);
        runtimeSnapshot = null;
      }
      if (!runtimeSnapshot) {
        setState((current) => routeToLandingAfterSignerExit(current, null));
        return;
      }
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot?.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot?.peer_permission_states ?? current.peerPermissionStates,
        runtimeWarning: null,
        dashboardLoadError: null,
        runtimeSnapshot,
      }));
    },
    async pingPeer(pubkey) {
      const snapshot = getState();
      const runtimeSnapshot = await adapter.pingPeer(snapshot.runtimeSnapshot, pubkey, controller);
      if (!runtimeSnapshot) return;
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === runtimeSnapshot.profile?.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
        runtimeWarning: null,
        dashboardLoadError: null,
        runtimeSnapshot,
      }));
    },
    async saveOperatorSettings(input) {
      const snapshot = getState();
      const selectedProfile = getSelectedProfile();
      if (!selectedProfile) return;
      const runtimeSnapshot = await adapter.applyOperatorSettings(
        selectedProfile,
        snapshot.runtimeSnapshot,
        input,
        controller,
      );
      // D.4: null return = session drift. UI keeps its current view.
      if (!runtimeSnapshot) return;
      setState((current) => ({
        ...current,
        profiles:
          runtimeSnapshot.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === selectedProfile.id ? runtimeSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates:
          runtimeSnapshot.peer_permission_states ?? current.peerPermissionStates,
        runtimeWarning: null,
        runtimeSnapshot,
        activeView: 'dashboard',
        activeDashboardTab: 'settings',
      }));
    },
    async logout() {
      const snapshot = getState();
      const stoppedSnapshot = snapshot.runtimeSnapshot?.active
        ? await adapter.stopSession(snapshot.runtimeSnapshot, controller)
        : null;
      setState((current) => ({
        ...current,
        profiles:
          stoppedSnapshot?.profile == null
            ? current.profiles
            : current.profiles.map((profile) =>
                profile.id === stoppedSnapshot.profile?.id ? stoppedSnapshot.profile ?? profile : profile,
              ),
        peerPermissionStates: adapter.defaultPeerPermissionStates(),
        runtimeWarning: null,
        dashboardLoadError: null,
        runtimeSnapshot: null,
        activeView: 'landing',
        activeDashboardTab: 'signer',
        unlockPassphrase: '',
        draftSecrets: createDefaultDraftSecrets(),
      }));
    },
    async clearDeviceCredentials() {
      const snapshot = getState();
      // Stop the live signer, then tear down every profile's runtime session.
      if (snapshot.runtimeSnapshot?.active) {
        await adapter.stopSession(snapshot.runtimeSnapshot, controller).catch(() => null);
      }
      for (const profile of snapshot.profiles) {
        void adapter.disposeRuntimeSessionForProfile(profile.id, controller);
      }
      // Erase the shared device list and this tab's session, then reset to a
      // clean default in-memory state so a reload also starts fresh.
      clearGlobalState();
      clearSessionState();
      setState(() => createDefaultState());
    },
    updateSettings(field, checked) {
      setState((current) => ({
        ...current,
        settings: {
          ...current.settings,
          [field]: checked,
        },
      }));
    },
  };
}
