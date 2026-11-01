# `BACKUP_AGE_RECIPIENT` synthetic canary workflow draft

Status: review draft only. The existing release/SQL hold remains active; this draft does not clear it. Runnable YAML is stored outside `.github/workflows` at [`docs/workflow-drafts/backup-recipient-canary.yml`](../workflow-drafts/backup-recipient-canary.yml); GitHub Actions will not discover it there. It has not been copied into the active workflow directory, dispatched, or merged.

## Evidence and scope

The user reports that the GitHub Repository secrets UI lists the name `BACKUP_AGE_RECIPIENT`. No secret value was read. Presence of the name does not establish the value is a valid age recipient, that any particular workflow can access it, or that a held private key can decrypt ciphertext encrypted to it.

The current #466 draft uses a `workflow_dispatch` `age_recipient` input. That is separate from the repository secret; the canary draft consumes only `${{ secrets.BACKUP_AGE_RECIPIENT }}` and does not change or invoke #466's input workflow.

The canary encrypts only a fixed, non-sensitive synthetic string. It does not access a database, call `pg_dump`, use production backup artifacts, inspect or emit the recipient, or handle a private key. It tests two bounded facts: the job can access the configured repository secret, and a private-key holder can decrypt that particular artifact. It does not prove source identity, actual backup quality, retention beyond this one-day artifact, or complete Supabase recovery.

## Workflow and secret authorization

- Trigger: manual `workflow_dispatch`; a job-level guard fails unless the ref is exactly `refs/heads/main`. No inputs are accepted.
- Job scope: protected GitHub Environment named `backup-recipient-canary`; no checkout; `permissions: {}`; five-minute timeout; serialized runs; pinned `actions/upload-artifact` v4.6.2; one-day artifact retention.
- Required external GitHub configuration before activation: repository/environment administrator must create the named environment, restrict its deployment branches to `main`, and configure required reviewers. Confirm repository Actions permissions and artifact audience. Do not move the file into `.github/workflows` until those controls are verified. The YAML in this draft cannot itself prove that the environment protection exists.
- Secret scope: the only secret referenced is the repository secret `BACKUP_AGE_RECIPIENT`, passed to the encrypt step's process environment. No user input can override it. The script avoids shell tracing, writes the recipient to a mode-600 temporary recipients file, captures age diagnostics outside the artifact, and emits fixed failure messages. The temp directory is removed on exit.
- Artifacts contain only the age ciphertext, SHA-256 checksum, and a minimal manifest with synthetic scope and ciphertext digest. The workflow reports only artifact ID and upload digest. The canary artifact is visible under normal repository Actions artifact access; ciphertext is synthetic and does not include customer data.

## Holder-side verification and failure controls

After an authorized canary run, the private-key holder downloads the artifact using their own GitHub access, verifies `sha256sum -c canary.txt.age.sha256`, decrypts `canary.txt.age` locally with their own key (for example, `age --decrypt --identity <local-private-key-path> --output canary.txt canary.txt.age`), and compares the result with the fixed three-line synthetic string in the workflow. They report only run/artifact ID, checksum pass/fail, decrypt pass/fail, and whether the plaintext comparison passed. They do not send the key, recipient, decrypted file, or raw diagnostics.

Missing/unavailable secret, age installation failure, recipient parse/encryption failure, empty ciphertext, artifact upload failure/missing files, missing artifact ID/digest, or failed checksum/decryption/plaintext comparison is a failed canary. Tool stderr is not emitted. A failed canary does not trigger a backup, migration, retry against production, or private-key recovery action. Any correction to the repository secret value is an external credential/configuration change and is out of this draft's scope.

## Synthetic-only validation plan

1. Parse the draft YAML and statically assert the path is outside `.github/workflows`, trigger is manual-only, ref guard is main-only, permissions are empty, secret reference is exactly `secrets.BACKUP_AGE_RECIPIENT`, artifact inputs exclude plaintext and recipient files, and retention is one day.
2. Run the encryption and offline decrypt/checksum flow with an ephemeral synthetic age keypair and a local stand-in for the secret. Use only the fixed canary text; delete the synthetic key and plaintext afterward.
3. Exercise fail-closed cases with no recipient and an invalid synthetic recipient. Verify failures are nonzero and diagnostics never include the recipient string. Statically verify missing artifact files are configured to error; the hosted upload action itself cannot be exercised without a GitHub Actions run.
4. Do not dispatch the formal workflow, access GitHub secret contents, run a production backup, access a production database, or use a private key.

## Local validation completed

- PyYAML parsed the draft and static checks confirmed manual-only trigger, main-only job/guard, empty token permissions, the exact repo-secret context, ciphertext/checksum/manifest-only upload paths, missing-file failure, and one-day retention.
- Extracted the draft encryption step and ran it with age v1.2.1 plus a newly generated disposable synthetic keypair. Checksum verification, offline decrypt, and fixed plaintext comparison passed. Empty and malformed synthetic recipients failed closed; neither test value appeared in captured stdout/stderr.
- The GitHub artifact action, environment approval settings, repository-secret access, and GitHub-hosted execution were not exercised. The synthetic keypair and temporary plaintext were local test material only; no existing private key or repository secret was accessed.

## 參考做法

- GitHub Actions — [Using secrets in GitHub Actions](https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions): pass secrets only through the required step context; do not print them. Adapted by limiting secret exposure to the encryption step and keeping diagnostics fixed.
- GitHub Actions — [Managing environments for deployment](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments): environment protection and branch restrictions provide an independent approval gate; the environment's existence and policy must be configured outside this YAML.
- age — [age encryption](https://github.com/FiloSottile/age) (BSD 3-Clause): public-key encryption uses recipient-only encryption and holder-side identity decryption. Reimplemented as a fixed synthetic canary; no age code is copied.
- Root cause vs symptom: the previous evidence established only that the secret's name appears in UI, not that its value is runtime-usable or matches a held key. A ciphertext-only canary tests that narrow compatibility chain; it deliberately does not claim recovery-point validity.
