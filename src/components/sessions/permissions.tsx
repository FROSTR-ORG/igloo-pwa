import type { SignerSession, PermissionPolicy } from '@cmdcode/nostr-connect'
import { Test } from '@vbyte/micro-lib'

// Common NIP-46 permissions (excluding non-configurable ones)
const COMMON_PERMISSIONS = [
  'sign_event',
  'nip04_encrypt',
  'nip04_decrypt',
  'nip44_encrypt',
  'nip44_decrypt'
]

interface PermissionsDropdownProps {
  session: SignerSession
  editingPermissions: PermissionPolicy
  newEventKind: string
  onPermissionChange: (permissions: PermissionPolicy) => void
  onEventKindChange: (eventKind: string) => void
  onUpdateSession: () => void
}

export function PermissionsDropdown({
  session,
  editingPermissions,
  newEventKind,
  onPermissionChange,
  onEventKindChange,
  onUpdateSession
}: PermissionsDropdownProps) {

  const updatePermission = (permission: string, enabled: boolean) => {
    onPermissionChange({
      ...editingPermissions,
      [permission]: enabled
    })
  }

  const addEventKind = () => {
    const kind = parseInt(newEventKind)
    if (!Test.is_number(kind)) return
    const kinds = Object.assign({}, editingPermissions.kinds)
    if (!(kind in kinds)) {
      onPermissionChange({
        ...editingPermissions,
        kinds: { ...kinds, [kind]: true }
      })
    }

    // Clear the input
    onEventKindChange('')
  }

  const removeEventKind = (kind: number) => {
    const kinds = Object.assign({}, editingPermissions.kinds)
    if (kind in kinds) {
      delete kinds[kind]
      onPermissionChange({ ...editingPermissions, kinds })
    }
  }

  return (
    <div className="session-permissions-dropdown">
      <h4 className="permissions-title">Permissions</h4>
      <div className="permissions-list">
        {COMMON_PERMISSIONS.map(permission => {
          if (permission === 'sign_event') {
            const kinds = Object.assign({}, editingPermissions.kinds)
            return (
              <div key={permission} className="permission-item sign-event-permission">
                <div className="permission-header">
                  <span className="permission-name">{permission}</span>
                </div>
                <div className="event-kinds-list">
                  {Object.keys(kinds).map(kind => (
                    <div key={kind} className="event-kind-item">
                      <span className="event-kind-number">{kind}</span>
                      <button
                        onClick={() => removeEventKind(parseInt(kind))}
                        className="remove-event-kind-btn"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
                <div className="add-event-kind">
                  <input
                    type="number"
                    placeholder="Event kind (e.g. 1)"
                    value={newEventKind}
                    onChange={(e) => onEventKindChange(e.target.value)}
                    className="event-kind-input"
                    onKeyPress={(e) => e.key === 'Enter' && addEventKind()}
                  />
                  <button
                    onClick={addEventKind}
                    className="add-event-kind-btn"
                  >
                    Add
                  </button>
                </div>
              </div>
            )
          } else {
            const isEnabled = editingPermissions.methods[permission] === true
            
            return (
              <div key={permission} className="permission-item">
                <label className="permission-label">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={(e) => updatePermission(permission, e.target.checked)}
                    className="permission-checkbox"
                  />
                  <span className="permission-name">{permission}</span>
                </label>
              </div>
            )
          }
        })}
      </div>
      <div className="permissions-actions">
        <button
          onClick={onUpdateSession}
          className="session-btn-primary permissions-update-btn"
        >
          Update Permissions
        </button>
      </div>
    </div>
  )
} 