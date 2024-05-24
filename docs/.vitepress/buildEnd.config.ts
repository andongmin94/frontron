import path from 'path'
import { writeFileSync } from 'fs'
import { Feed } from 'feed'
import { createContentLoader, type SiteConfig } from 'vitepress'

const siteUrl = 'https://frontron.vercel.app'
const blogUrl = `${siteUrl}/blog`

export const buildEnd = async (config: SiteConfig) => {
  const feed = new Feed({
    title: 'Frontron',
    description: 'GUI Library for Desktop App Development',
    id: blogUrl,
    link: blogUrl,
    language: 'en',
    image: 'https://frontron.vercel.app/frontron.svg',
    favicon: 'https://frontron.vercel.app/frontron.svg',
    copyright: 'Copyright © 2024 andongmin',
  })

  const posts = await createContentLoader('blog/*.md', {
    excerpt: true,
    render: true,
  }).load()

  posts.sort(
    (a, b) =>
      +new Date(b.frontmatter.date as string) -
      +new Date(a.frontmatter.date as string),
  )

  for (const { url, excerpt, frontmatter, html } of posts) {
    feed.addItem({
      title: frontmatter.title,
      id: `${siteUrl}${url}`,
      link: `${siteUrl}${url}`,
      description: excerpt,
      content: html,
      author: [
        {
          name: frontmatter.author.name,
        },
      ],
      date: frontmatter.date,
    })
  }

  writeFileSync(path.join(config.outDir, 'blog.rss'), feed.rss2())
}
