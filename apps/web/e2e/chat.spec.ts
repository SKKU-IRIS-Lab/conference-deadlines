import { expect, test } from "@playwright/test"

test("floating chat fits the viewport and supports keyboard closing", async ({
  page,
}, testInfo) => {
  await page.goto("/")
  const trigger = page.getByRole("button", { name: "학회 AI 열기" })
  await trigger.click()
  const panel = page.getByRole("dialog", { name: "학회 AI 도우미" })
  await expect(panel).toBeVisible()
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()
  if (!box || !viewport) throw new Error("missing viewport geometry")
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.y).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(viewport.width)
  expect(box.y + box.height).toBeLessThanOrEqual(viewport.height)
  await page.screenshot({ path: `/tmp/conference-chat-${testInfo.project.name}.png` })
  await page.keyboard.press("Escape")
  await expect(panel).toHaveCount(0)
  await expect(trigger).toBeFocused()
})
