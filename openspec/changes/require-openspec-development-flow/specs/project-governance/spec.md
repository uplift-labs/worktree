## MODIFIED Requirements

### Requirement: OpenSpec Role
OpenSpec SHALL be used as the mandatory planning and behavior-specification layer for all project development changes, while code, tests, and contract files remain executable and public sources of truth.

#### Scenario: Project development change
- **WHEN** a feature, bug fix, behavior change, refactor, test change, behavior-documentation change, tooling change, or repository-instruction change is requested
- **THEN** the work SHALL start with or use an OpenSpec change before direct implementation

#### Scenario: Informational or read-only request
- **WHEN** the request is purely informational, read-only investigation, or review without project edits
- **THEN** an OpenSpec change SHALL NOT be required

#### Scenario: Higher-priority instruction conflict
- **WHEN** a higher-priority instruction explicitly requires a different path
- **THEN** the agent SHALL state the reason before proceeding outside the OpenSpec flow

## ADDED Requirements

### Requirement: Agent-Enforced OpenSpec Flow
Agents SHALL proactively enforce the OpenSpec flow when a user requests project changes.

#### Scenario: Unclear change request
- **WHEN** a requested project change has unclear goals, scope, or requirements
- **THEN** the agent SHALL use the OpenSpec exploration flow before proposing or implementing the change

#### Scenario: New change without existing proposal
- **WHEN** a user requests implementation and no existing OpenSpec change covers the work
- **THEN** the agent SHALL create or update OpenSpec proposal artifacts before making project edits

#### Scenario: Existing approved change
- **WHEN** a user asks to implement an existing OpenSpec change
- **THEN** the agent SHALL use the OpenSpec apply flow and work through the change tasks

#### Scenario: Completed change
- **WHEN** implementation and verification for an OpenSpec change are complete
- **THEN** the agent SHALL use the OpenSpec archive flow when the user asks to finalize the change

### Requirement: Project OpenSpec Command Permission
The project OpenCode configuration SHALL allow the bash command string that equals `openspec` without asking for user permission.

#### Scenario: Bare OpenSpec command
- **WHEN** an agent requests the bash command `openspec`
- **THEN** OpenCode SHALL allow the command without prompting for permission

#### Scenario: OpenSpec command with arguments
- **WHEN** an agent requests a bash command string that begins with `openspec `
- **THEN** this OpenSpec-specific permission SHALL NOT allow that command

#### Scenario: Non-OpenSpec command string
- **WHEN** an agent requests a bash command string that does not equal `openspec`
- **THEN** this OpenSpec-specific permission SHALL NOT allow that command
