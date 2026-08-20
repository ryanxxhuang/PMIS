// Material Symbols Outlined 的統一入口(取代 lucide-react)。
// 字型由 @material-symbols/font-400 self-host(main.jsx import;wght 凍結 400、保留 FILL 軸)。
// ligature 名走 ::before content: attr(data-i)(index.css),不放進子文字節點——
// 否則 icon 名會混進元素的 textContent,Playwright 的 getByText(exact) 與複製貼上都會撿到
// 「photo_camera選照片…」這種髒字串。generated content 不進 textContent,行為與 SVG 圖示一致。
// 選取態(導覽/角色卡)用 fill 切 FILL 1,對應原型的 .msy-f。
export function MSym({ name, size = 20, fill = false, className = '', style, ...props }) {
  return (
    <span
      aria-hidden
      data-i={name}
      className={`material-symbols-outlined shrink-0 ${className}`}
      style={{ fontSize: size, fontVariationSettings: `'FILL' ${fill ? 1 : 0}`, ...style }}
      {...props}
    />
  )
}
