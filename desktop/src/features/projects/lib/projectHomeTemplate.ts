import { setCanvas } from "@/shared/api/tauri";
import type { ChannelTemplate } from "@/shared/api/types";
import type { Project } from "@/features/projects/hooks";

export const PROJECT_HOME_TEMPLATE_ID = "builtin:project-home";

export const PROJECT_HOME_CANVAS_TEMPLATE = `# Project Channel: {{PROJECT_NAME}}

This channel is the working home of **{{PROJECT_NAME}}**.

- Initial repository: \`{{REPO_SLUG}}\`
- Repository owner: \`{{REPO_OWNER_HEX}}\`
- Clone URL: \`{{REPO_CLONE_URL}}\`
- Project channel: \`{{CHANNEL_UUID}}\`

Everything about this project—decisions, tasks, code review, and releases—happens here, in the open.

## How to think about this channel

- **The channel is the project's memory.** If you did it and did not post it, it did not happen. Milestones (picked up, blocked, PR up, merged, done) are top-level posts; details go in threads.
- **The board is the task queue.** Every task is a card on this channel's Kanban board (\`buzz kanban\`). "Add a task", "create a todo", "put it on the board" all mean a card — never a git issue. Work starts from a card.
- **Issues are for code work items inside the repo** — a bug, a chore, a spec to implement — not for plain tasks.
- **The repository is the source of truth for code; the channel is the source of truth for intent.** Read both before acting.
- **One owner per task.** Claim before you build. If it is assigned to someone else, review or unblock—do not duplicate.

## What you can do here

| Action | Command |
| --- | --- |
| Inspect the repository | \`buzz repos get --owner {{REPO_OWNER_HEX}} --id {{REPO_SLUG}}\` |
| Add a task to the board | \`buzz kanban add --channel {{CHANNEL_UUID}} --title "..." [--description -] [--column <id>]\` |
| Move / assign / edit a card | \`buzz kanban set --channel {{CHANNEL_UUID}} --card <card_id> [--column <id>] [--assignee <hex>]\` |
| List board cards | \`buzz kanban list --channel {{CHANNEL_UUID}}\` |
| Open a code issue in the repo | \`buzz issues create --repo-owner {{REPO_OWNER_HEX}} --repo-id {{REPO_SLUG}} --title "..." --content -\` |
| Track a code issue's state | \`buzz issues status --issue <id> --repo-owner {{REPO_OWNER_HEX}} --repo-id {{REPO_SLUG}} --status open|resolved|closed|draft\` |
| Open a review | \`buzz pr open --repo-owner {{REPO_OWNER_HEX}} --repo-id {{REPO_SLUG}} --subject "..." --body-file - --commit <tip> --clone {{REPO_CLONE_URL}} --branch-name <branch> --channel {{CHANNEL_UUID}}\` |
| Update a review | \`buzz pr update --repo-owner {{REPO_OWNER_HEX}} --repo-id {{REPO_SLUG}} --pr <id> --pr-author <hex> --commit <tip> --clone {{REPO_CLONE_URL}}\` |
| Mark a review merged or closed | \`buzz pr status --pr <id> --repo-owner {{REPO_OWNER_HEX}} --repo-id {{REPO_SLUG}} --status merged|closed\` |
| Share files or artifacts | \`buzz upload file --file <path>\` |
| Update this living document | \`buzz canvas set --channel {{CHANNEL_UUID}} --content -\` |

## Workflow

1. **Pick up:** Find or create a board card (\`buzz kanban\`), self-assign it, move it to the in-progress column, and post a one-line “picked up” message in the channel. Open a repo issue only if the work is a concrete code change.
2. **Build:** Clone or reuse a checkout under \`REPOS/\`. Work on a branch, never the default branch. Follow the repository's configured commit and sign-off policy.
3. **Verify:** Run the fullest relevant test suite before calling anything done.
4. **Ship:** Open a review and post the returned Buzz link verbatim so it renders as a card. Mark the issue resolved when merged.
5. **Report:** @mention whoever delegated the work in the message that delivers the result or blocker—not in acknowledgements.

## Norms

- Reply in-thread to continue a topic; use a top-level post for a new topic. Avoid bare acknowledgements.
- @mention only when someone must act; naming someone in narrative does not require an @mention.
- Blocked for more than 30 minutes after honest effort? Post the blocker and what you tried.
- Praise in public; correct the work, not the person.
- Give decisions of record—scope cuts, API choices, and deferrals—their own top-level post so they remain findable.

Keep this canvas current as the project evolves.`;

export const PROJECT_HOME_CHANNEL_TEMPLATE: ChannelTemplate = {
  id: PROJECT_HOME_TEMPLATE_ID,
  name: "Project home",
  description: null,
  channelType: "stream",
  visibility: "open",
  canvasTemplate: PROJECT_HOME_CANVAS_TEMPLATE,
  agents: { personas: [], teams: [] },
  isBuiltin: true,
  createdAt: "",
  updatedAt: "",
};

export function renderProjectHomeCanvas(input: {
  channelId: string;
  project: Project;
}) {
  const repository = input.project.repositories[0];
  const values: Record<string, string> = {
    CHANNEL_UUID: input.channelId,
    PROJECT_NAME: input.project.name,
    REPO_CLONE_URL: repository?.cloneUrls[0] ?? "Unavailable",
    REPO_OWNER_HEX: repository?.owner ?? input.project.owner,
    REPO_SLUG: repository?.dtag ?? input.project.dtag,
  };
  return Object.entries(values).reduce(
    (content, [key, value]) => content.replaceAll(`{{${key}}}`, value),
    PROJECT_HOME_CANVAS_TEMPLATE,
  );
}

export async function applyProjectHomeCanvas(input: {
  channelId: string;
  project: Project;
}) {
  try {
    await setCanvas({
      channelId: input.channelId,
      content: renderProjectHomeCanvas(input),
    });
    return true;
  } catch {
    return false;
  }
}
