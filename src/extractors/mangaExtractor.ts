import * as cheerio from "cheerio";
import type { Element } from "domhandler";
import { MangaCard } from "../types";
import { config } from "../config/config";

export class MangaExtractor {
  /**
   * Extract manga card information from a cheerio element
   */
  static extractMangaCard(
    $: cheerio.CheerioAPI,
    elem: cheerio.Cheerio<Element>,
  ): MangaCard | null {
    try {
      const href = elem.attr("href");
      if (!href || !href.includes("/manga/")) return null;

      const id = href.match(/\/manga\/(\d+)\//)?.[1];
      if (!id) return null;

      const title = elem.attr("title") || elem.text().trim();
      if (!title) return null;

      const img = elem.find("img");
      const imageUrl = img.attr("src") || img.attr("data-src");

      // Try to get additional info from surrounding elements
      const infoDiv = elem.find("div, span").last();
      const infoText = infoDiv.text();

      const type = infoText.match(/manga|manhwa|manhua/i)?.[0];
      const year = infoText.match(/\d{4}/)?.[0];
      const status = infoText.match(/publishing|finished/i)?.[0];

      return {
        id,
        title,
        url: config.baseURL + href,
        imageUrl,
        type,
        year,
        status,
      };
    } catch (error) {
      console.error("Error extracting manga card:", error);
      return null;
    }
  }

  /**
   * Extract manga card from a single item div that contains split <a> tags
   */
  static extractMangaCardFromItem(
    $: cheerio.CheerioAPI,
    item: cheerio.Cheerio<Element>,
  ): MangaCard | null {
    try {
      const href = item.find('a[href*="/manga/"]').first().attr("href");
      if (!href) return null;

      const id = href.match(/\/manga\/(\d+)\//)?.[1];
      if (!id) return null;

      const img = item.find("img").first();
      const imageUrl = img.attr("src") || img.attr("data-src");

      const title = item.find(".line-clamp-2").first().text().trim();
      const description = item.find(".line-clamp-2").next().text().trim();
      if (!title) return null;

      // Type, year, status are in colored badge divs (bg-purple, bg-orange, bg-green)
      const type = item.find('[class*="bg-purple"]').text().trim() || undefined;
      const year = item.find('[class*="bg-orange"]').text().trim() || undefined;
      const status =
        item.find('[class*="bg-green"]').text().trim() || undefined;

      // Genres are in bg-card badge divs (second flex-wrap group)
      const genreContainer = item.find(".flex-wrap").last();
      const genres: string[] = [];
      genreContainer.find("div").each((_, el) => {
        const genre = $(el).text().trim();
        if (genre) genres.push(genre);
      });

      return {
        id,
        title,
        url: config.baseURL + href,
        description,
        imageUrl,
        type,
        year,
        status,
        genres: genres.length > 0 ? genres : undefined,
      };
    } catch (error) {
      console.error("Error extracting manga card from item:", error);
      return null;
    }
  }

  /**
   * Extract manga cards by iterating direct child divs of a grid container
   */
  static extractMangaCardsFromGrid(
    $: cheerio.CheerioAPI,
    container: cheerio.Cheerio<Element>,
  ): MangaCard[] {
    const cards: MangaCard[] = [];

    container.children("div").each((_, elem) => {
      const card = this.extractMangaCardFromItem($, $(elem as Element));
      if (card) cards.push(card);
    });

    return cards;
  }

  /**
   * Extract multiple manga cards from a container
   */
  static extractMangaCards(
    $: cheerio.CheerioAPI,
    selector: string = 'a[href*="/manga/"]',
    context?: cheerio.Cheerio<Element>,
  ): MangaCard[] {
    const cards: MangaCard[] = [];

    const elements = context ? context.find(selector) : $(selector);

    elements.each((_, elem) => {
      const card = this.extractMangaCard($, $(elem as Element));
      if (card) {
        cards.push(card);
      }
    });

    return cards;
  }

  /**
   * Extract manga metadata from detail page
   */
  static extractMetadata(
    $: cheerio.CheerioAPI,
    label: string,
  ): string | undefined {
    let value: string | undefined;

    $("label").each((_, elem) => {
      const labelText = $(elem).text().trim();
      if (labelText.toLowerCase() === label.toLowerCase()) {
        const sibling = $(elem).next("div");
        if (sibling.length) {
          value = sibling.text().trim();
          return false; // break
        }
      }
    });

    return value;
  }

  /**
   * Extract list metadata (comma-separated values)
   */
  static extractListMetadata($: cheerio.CheerioAPI, label: string): string[] {
    const value = this.extractMetadata($, label);
    if (!value) return [];
    return value
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
  }

  /**
   * Extract alternative titles
   */
  static extractAlternativeTitles($: cheerio.CheerioAPI): string[] {
    const titles: string[] = [];

    $("div, p, span").each((_, elem) => {
      const text = $(elem).text();
      const altMatch = text.match(/Alternative.*?:(.+?)(?:\n|$)/i);
      if (altMatch) {
        titles.push(
          ...altMatch[1]
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
        );
      }
    });

    return titles;
  }

  /**
   * Extract genres/tags
   */
  static extractGenres($: cheerio.CheerioAPI): string[] {
    const genres: string[] = [];

    $('a[href*="/search?genre="], .genre, .tag, a[href*="/genre/"]').each(
      (_, elem) => {
        const genre = $(elem).text().trim();
        if (genre && !genres.includes(genre)) {
          genres.push(genre);
        }
      },
    );

    return genres;
  }

  /**
   * Extract description/synopsis
   */
  static extractDescription($: cheerio.CheerioAPI): string | undefined {
    // Try multiple selectors for description
    const selectors = [
      "p.description",
      ".description",
      "div.summary",
      ".synopsis",
      'p[itemprop="description"]',
    ];

    for (const selector of selectors) {
      const desc = $(selector).first().text().trim();
      if (desc && desc.length > 50) {
        return desc;
      }
    }

    // Fallback: find longest paragraph
    let longestDesc = "";
    $("p").each((_, elem) => {
      const text = $(elem).text().trim();
      if (text.length > longestDesc.length && text.length > 100) {
        longestDesc = text;
      }
    });

    return longestDesc || undefined;
  }

  /**
   * Extract cover image
   */
  static extractCoverImage(
    $: cheerio.CheerioAPI,
    title: string,
  ): string | undefined {
    // Try multiple selectors
    const selectors = [
      `img[alt*="${title}"]`,
      ".manga-cover img",
      ".cover img",
      'img[src*="cover"]',
      "img",
    ];

    for (const selector of selectors) {
      const img = $(selector).first();
      const src = img.attr("src") || img.attr("data-src");
      if (src && !src.includes("logo") && !src.includes("icon")) {
        return src.startsWith("http") ? src : config.baseURL + src;
      }
    }

    return undefined;
  }
}
