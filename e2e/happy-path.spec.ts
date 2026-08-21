import { expect, test } from "@playwright/test";

test("opens a local recording, adds a note, saves and exports", async ({ page }) => {
  await page.goto("/?demo=1", { waitUntil: "domcontentloaded", timeout: 120_000 });
  await expect(page.getByText("Tasarım incelemesi").first()).toBeVisible();
  await expect(page.getByText("DÜZENLEME REÇETESİ")).toBeVisible();
  await page.getByLabel("Açıklama metni").fill("Karar noktası");
  await page.getByLabel("Açıklama ekle").click();
  await expect(page.getByText("Karar noktası", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Kaydet" }).click();
  await expect(page.getByText(/düzenleme reçetesi kaydedildi/i)).toBeVisible();
  await page.getByRole("button", { name: /H.264 dışa aktar/ }).click();
  await expect(page.getByText(/design-review.mp4/)).toBeVisible();
});
