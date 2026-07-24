import { expect, test } from '@playwright/test';

test.use({ headless: true });

test('harvests stable ids while a sanitized virtual list replaces DOM nodes', async ({ page }) => {
  const outboundRequests: string[] = [];
  await page.route('**/*', async (route) => {
    outboundRequests.push(route.request().url());
    await route.abort();
  });
  await page.setContent('<main id="fixture-feed"></main>');

  const allIds = Array.from(
    { length: 50 },
    (_, index) => `9${String(index + 1).padStart(17, '0')}`,
  );
  const batches: string[][] = [];
  for (let start = 0; start < allIds.length; start += 8) {
    batches.push(allIds.slice(start, start + 10));
    if (start + 10 >= allIds.length) {
      break;
    }
  }

  const renderBatch = async (batch: string[]): Promise<void> => {
    await page.locator('#fixture-feed').evaluate((feed, ids) => {
      feed.replaceChildren(
        ...ids.map((id) => {
          const article = document.createElement('article');
          article.dataset.testid = 'tweet';
          const link = document.createElement('a');
          link.href = `https://x.com/shuhai_fixture/status/${id}`;
          link.textContent = 'Open fixture item';
          const text = document.createElement('div');
          text.dataset.testid = 'tweetText';
          text.textContent =
            id === '900000000000000001'
              ? '</script><img src="https://tracker.invalid/pixel"> {{untrusted}}'
              : `Sanitized fixture ${id}`;
          article.append(link, text);
          return article;
        }),
      );
    }, batch);
  };

  const collectVisibleIds = async (): Promise<string[]> =>
    page.locator('article[data-testid="tweet"]').evaluateAll((articles) =>
      articles.flatMap((article) => {
        const href = article.querySelector('a[href*="/status/"]')?.getAttribute('href') ?? '';
        const text = article.querySelector('[data-testid="tweetText"]')?.textContent?.trim();
        const match = href.match(/\/status\/(\d{1,19})$/);
        return match?.[1] && text ? [match[1]] : [];
      }),
    );

  const seen = new Set<string>();
  for (const batch of batches.slice(0, 3)) {
    await renderBatch(batch);
    const visibleIds = await collectVisibleIds();
    for (const id of visibleIds) {
      seen.add(id);
    }
  }

  const serializedCheckpoint = JSON.stringify({ seenIds: [...seen] });
  const restored = JSON.parse(serializedCheckpoint) as { seenIds: string[] };
  const resumedSeen = new Set(restored.seenIds);

  for (const batch of batches) {
    await renderBatch(batch);
    const visibleIds = await collectVisibleIds();
    for (const id of visibleIds) {
      resumedSeen.add(id);
    }
  }

  expect(resumedSeen.size).toBe(50);
  await expect(page.locator('#fixture-feed img')).toHaveCount(0);
  expect(outboundRequests).toEqual([]);
});
