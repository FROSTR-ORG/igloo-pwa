# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, adapted for this repository.

## [0.2.0] - 2026-03-27

### Added
- Root project documentation for usage, testing, and contribution flow.

### Changed
- Profile import, recovery, onboarding, and rotation flows now consume structured `groupPackage` with embedded `groupName`.
- New-group creation now asks for a group name explicitly and uses it consistently in generated group/share labeling.
- Persisted profile handling no longer treats remote peer policy observations as durable profile state.

### Fixed
- Browser-side rotation creation now preserves embedded group metadata through raw group JSON helpers.
- App and fixture surfaces now match the current package schema and error formatting model.
