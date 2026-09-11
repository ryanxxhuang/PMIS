// 檢查版控內 Markdown 的本機連結;網址不連網、程式區塊不當成連結。
import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

export function localLinks(markdown) {
  const prose = markdown.replace(/^( {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\2[^\n]*$/gm, '')
    .replace(/`[^`\n]+`/g, '')
  return [...prose.matchAll(/!?\[[^\]\n]*\]\(\s*(<[^>]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)]
    .map((match) => match[1].replace(/^<|>$/g, ''))
    .filter((target) => !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(target))
}

export function headingIds(markdown) {
  const counts = new Map(), ids = new Set()
  for (const match of markdown.matchAll(/^#{1,6}\s+(.+?)\s*#*$/gm)) {
    const id = match[1].replace(/<[^>]*>/g, '').toLowerCase()
      .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\-\s]/gu, '').replace(/ /g, '-')
    const count = counts.get(id) || 0
    counts.set(id, count + 1)
    ids.add(count ? `${id}-${count}` : id)
  }
  for (const match of markdown.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)) ids.add(match[1])
  return ids
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
    .split('\0').filter((file) => file.endsWith('.md') && existsSync(file))
  const failures = []
  let checked = 0
  for (const file of new Set(files)) {
    for (const target of localLinks(readFileSync(file, 'utf8'))) {
      checked++
      const [path, fragment] = target.split('#')
      let destination, anchor
      try {
        destination = path ? resolve(dirname(file), decodeURIComponent(path)) : resolve(file)
        anchor = fragment && decodeURIComponent(fragment)
      } catch { failures.push(`${file}: 無效編碼 ${target}`); continue }
      if (!existsSync(destination)) failures.push(`${file}: 檔案不存在 ${target}`)
      else if (anchor && destination.endsWith('.md') && statSync(destination).isFile()
        && !headingIds(readFileSync(destination, 'utf8')).has(anchor)) {
        failures.push(`${file}: 標題不存在 ${target}`)
      }
    }
  }
  for (const failure of failures) console.error(failure)
  console.log(`Markdown: ${new Set(files).size} files, ${checked} local links, ${failures.length} errors`)
  process.exitCode = failures.length ? 1 : 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
