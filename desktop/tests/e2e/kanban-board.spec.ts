import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

type MockMessageWindow = Window & {
  __BUZZ_E2E_EMIT_MOCK_MESSAGE__?: (input: {
    channelName: string;
    content: string;
    id?: string;
  }) => { id: string } | undefined;
  __BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?: (input: {
    channelName: string;
  }) => boolean;
};

async function openBoard(page: Page) {
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await page.getByTestId("channel-kanban-toggle").click();
  await expect(page.getByTestId("kanban-board-dialog")).toBeVisible();
  await expect(page.getByTestId("kanban-board")).toBeVisible();
}

test.describe("kanban board", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("renders the three fixed columns and creates a card", async ({
    page,
  }) => {
    await installMockBridge(page);
    await openBoard(page);

    for (const label of ["To do", "Doing", "Done"]) {
      await expect(
        page.getByRole("heading", { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }

    await page.getByTestId("kanban-add-todo").click();
    await expect(page.getByTestId("kanban-card-editor")).toBeVisible();
    await page.getByTestId("kanban-card-title").fill("Write the spec");
    await page.getByTestId("kanban-card-save").click();

    const todo = page.getByTestId("kanban-column-todo");
    await expect(todo.getByTestId("kanban-card")).toHaveText(/Write the spec/);
  });

  test("moves a card to another column via the editor", async ({ page }) => {
    await installMockBridge(page);
    await openBoard(page);

    await page.getByTestId("kanban-add-todo").click();
    await page.getByTestId("kanban-card-title").fill("Draft the API");
    await page.getByTestId("kanban-card-save").click();

    const card = page
      .getByTestId("kanban-column-todo")
      .getByTestId("kanban-card");
    await expect(card).toHaveText(/Draft the API/);

    await card.click();
    await expect(page.getByTestId("kanban-card-editor")).toBeVisible();
    // The column picker is the first "outline" combobox in the editor.
    await page.getByRole("button", { name: "To do" }).click();
    await page.getByRole("menuitem", { name: "Doing" }).click();
    await page.getByTestId("kanban-card-save").click();

    await expect(
      page.getByTestId("kanban-column-doing").getByTestId("kanban-card"),
    ).toHaveText(/Draft the API/);
    await expect(
      page.getByTestId("kanban-column-todo").getByTestId("kanban-card"),
    ).toHaveCount(0);
  });

  test("adds, renames and deletes columns", async ({ page }) => {
    await installMockBridge(page);
    await openBoard(page);

    // Default three columns.
    for (const label of ["To do", "Doing", "Done"]) {
      await expect(
        page.getByRole("heading", { name: new RegExp(`^${label}`) }),
      ).toBeVisible();
    }

    // Add a column.
    await page.getByTestId("kanban-add-column").click();
    await page.getByTestId("kanban-column-name").fill("In review");
    await page.getByTestId("kanban-column-save").click();
    const inReview = page.getByTestId("kanban-column-in-review");
    await expect(inReview).toBeVisible();

    // A card can be created directly into the new column.
    await inReview.getByTestId("kanban-add-in-review").click();
    await page.getByTestId("kanban-card-title").fill("Review the PR");
    await page.getByTestId("kanban-card-save").click();
    await expect(inReview.getByTestId("kanban-card")).toHaveText(
      /Review the PR/,
    );

    // Rename it.
    await page.getByTestId("kanban-column-menu-in-review").click();
    await page.getByRole("menuitem", { name: "Rename" }).click();
    await page.getByTestId("kanban-column-name").fill("QA");
    await page.getByTestId("kanban-column-save").click();
    await expect(page.getByRole("heading", { name: /^QA/ })).toBeVisible();

    // Delete it — its card falls into the Unsorted bucket, not lost.
    await page.getByTestId("kanban-column-menu-in-review").click();
    await page.getByRole("menuitem", { name: "Delete column" }).click();
    await expect(page.getByTestId("kanban-column-in-review")).toHaveCount(0);
    await expect(
      page.getByTestId("kanban-column-unsorted").getByTestId("kanban-card"),
    ).toHaveText(/Review the PR/);
  });

  test("creates a card from a chat message", async ({ page }) => {
    await installMockBridge(page);
    await page.goto("/");
    await page.getByTestId("channel-general").click();
    await expect(page.getByTestId("chat-title")).toHaveText("general");

    await expect
      .poll(() =>
        page.evaluate(
          () =>
            typeof (window as MockMessageWindow)
              .__BUZZ_E2E_EMIT_MOCK_MESSAGE__ === "function",
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as MockMessageWindow
            ).__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
              channelName: "general",
            }) ?? false,
        ),
      )
      .toBe(true);

    const messageId = await page.evaluate(() => {
      const emit = (window as MockMessageWindow).__BUZZ_E2E_EMIT_MOCK_MESSAGE__;
      if (!emit) throw new Error("emitter unavailable");
      const res = emit({
        channelName: "general",
        content: "Turn this into a task please",
        id: "c".repeat(64),
      });
      return res?.id ?? "";
    });
    expect(messageId).not.toBe("");

    const row = page.locator(
      `[data-testid="message-row"]:has-text("Turn this into a task please")`,
    );
    await row.hover();
    await row.getByTestId(`more-actions-${messageId}`).click({ force: true });
    await page.getByTestId(`add-to-board-${messageId}`).click();

    const editor = page.getByTestId("kanban-card-editor");
    await expect(editor).toBeVisible();
    await expect(
      editor.getByText("Linked to the selected chat message."),
    ).toBeVisible();
    await page.getByTestId("kanban-card-title").fill("Follow up from chat");
    await page.getByTestId("kanban-card-save").click();

    const card = page
      .getByTestId("kanban-column-todo")
      .getByTestId("kanban-card");
    await expect(card).toHaveText(/Follow up from chat/);
    await expect(
      card.getByRole("button", { name: "From message" }),
    ).toBeVisible();
  });
});
