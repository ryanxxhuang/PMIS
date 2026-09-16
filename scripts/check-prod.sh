#!/usr/bin/env sh
# 部署後核對正式站與 demo 站的 HTML 與安全標頭(D-025):
# 1) 回 200;2) 有 Content-Security-Policy 回應標頭且 script-src 只允許 'self';
# 3) HTML 沒有被 Cloudflare 邊緣自動注入的 Web Analytics beacon(cf-beacon)。
# 用瀏覽器 UA 抓:邊緣注入只對瀏覽器請求發生,curl 預設 UA 看不到。
# 用法:npm run check:prod  (或 sh scripts/check-prod.sh https://其他網址/)
set -u
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36'
urls="${*:-https://app.gov-agent.ai/ https://demo.gov-agent.ai/}"
fail=0
for u in $urls; do
  hdr=$(curl -s -D - -o /tmp/check-prod.html -A "$UA" -H 'Accept: text/html' --max-time 20 "$u") || { echo "FAIL $u: 連不上"; fail=1; continue; }
  code=$(printf '%s' "$hdr" | head -1 | awk '{print $2}')
  csp=$(printf '%s' "$hdr" | tr -d '\r' | grep -i '^content-security-policy:' | head -1)
  beacon=$(grep -c 'cf-beacon' /tmp/check-prod.html)
  ok=1
  [ "$code" = "200" ] || ok=0
  printf '%s' "$csp" | grep -q "script-src 'self'" || ok=0
  [ "$beacon" = "0" ] || ok=0
  if [ $ok = 1 ]; then echo "OK   $u (200, CSP script-src 'self', 無注入腳本)"
  else echo "FAIL $u (status=$code, csp=${csp:-無}, cf-beacon=$beacon)"; fail=1; fi
done
rm -f /tmp/check-prod.html
exit $fail
