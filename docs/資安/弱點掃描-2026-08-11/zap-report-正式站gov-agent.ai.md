# ZAP Scanning Report

ZAP by [Checkmarx](https://checkmarx.com/).


## Summary of Alerts

| Risk Level | Number of Alerts |
| --- | --- |
| High | 0 |
| Medium | 2 |
| Low | 3 |
| Informational | 5 |




## Insights

| Level | Reason | Site | Description | Statistic |
| --- | --- | --- | --- | --- |
| Low | Warning |  | ZAP warnings logged - see the zap.log file for details | 3    |
| Info | Informational | https://buylyonwoyvqdbvkkkbx.supabase.co | Percentage of endpoints with content type application/json | 50 % |
| Info | Informational | https://buylyonwoyvqdbvkkkbx.supabase.co | Percentage of endpoints with method OPTIONS | 50 % |
| Info | Informational | https://buylyonwoyvqdbvkkkbx.supabase.co | Percentage of endpoints with method POST | 50 % |
| Info | Informational | https://buylyonwoyvqdbvkkkbx.supabase.co | Count of total endpoints | 6    |
| Info | Informational | https://fonts.googleapis.com | Percentage of endpoints with content type text/css | 100 % |
| Info | Informational | https://fonts.googleapis.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://fonts.googleapis.com | Count of total endpoints | 1    |
| Info | Informational | https://fonts.gstatic.com | Percentage of endpoints with content type font/woff2 | 100 % |
| Info | Informational | https://fonts.gstatic.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://fonts.gstatic.com | Count of total endpoints | 17    |
| Info | Informational | https://gov-agent.ai | Percentage of responses with status code 2xx | 100 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with content type image/svg+xml | 13 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with content type text/css | 13 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with content type text/html | 20 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with content type text/javascript | 46 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with content type text/plain | 6 % |
| Info | Informational | https://gov-agent.ai | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://gov-agent.ai | Count of total endpoints | 15    |
| Info | Informational | https://gov-agent.ai | Percentage of slow responses | 100 % |
| Info | Informational | https://mail.google.com | Percentage of endpoints with content type application/binary | 100 % |
| Info | Informational | https://mail.google.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://mail.google.com | Count of total endpoints | 1    |
| Info | Informational | https://o4511731640500224.ingest.us.sentry.io | Percentage of endpoints with content type application/json | 100 % |
| Info | Informational | https://o4511731640500224.ingest.us.sentry.io | Percentage of endpoints with method POST | 100 % |
| Info | Informational | https://o4511731640500224.ingest.us.sentry.io | Count of total endpoints | 2    |
| Info | Informational | https://ssl.gstatic.com | Percentage of endpoints with content type image/x-icon | 100 % |
| Info | Informational | https://ssl.gstatic.com | Percentage of endpoints with method GET | 100 % |
| Info | Informational | https://ssl.gstatic.com | Count of total endpoints | 1    |







## Alerts

| Name | Risk Level | Number of Instances |
| --- | --- | --- |
| CSP: style-src unsafe-inline | Medium | 3 |
| Sub Resource Integrity Attribute Missing | Medium | 3 |
| Cross-Origin-Embedder-Policy Header Missing or Invalid | Low | 3 |
| Cross-Origin-Resource-Policy Header Missing or Invalid | Low | Systemic |
| Timestamp Disclosure - Unix | Low | Systemic |
| Information Disclosure - Information in Browser sessionStorage | Informational | 1 |
| Modern Web Application | Informational | 3 |
| Re-examine Cache-control Directives | Informational | 4 |
| Storable and Cacheable Content | Informational | 1 |
| Storable but Non-Cacheable Content | Informational | Systemic |




## Alert Detail



### [ CSP: style-src unsafe-inline ](https://www.zaproxy.org/docs/alerts/10055/)



##### Medium (High)

### Description

Content Security Policy (CSP) is an added layer of security that helps to detect and mitigate certain types of attacks. Including (but not limited to) Cross Site Scripting (XSS), and data injection attacks. These attacks are used for everything from data theft to site defacement or distribution of malware. CSP provides a set of standard HTTP headers that allow website owners to declare approved sources of content that browsers should be allowed to load on that page — covered types are JavaScript, CSS, HTML frames, fonts, images and embeddable objects such as Java applets, ActiveX, audio and video files.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: `content-security-policy`
  * Attack: ``
  * Evidence: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io; worker-src 'self' blob:; upgrade-insecure-requests`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: `content-security-policy`
  * Attack: ``
  * Evidence: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io; worker-src 'self' blob:; upgrade-insecure-requests`
  * Other Info: `style-src includes unsafe-inline.`
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: `content-security-policy`
  * Attack: ``
  * Evidence: `default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.ingest.us.sentry.io; worker-src 'self' blob:; upgrade-insecure-requests`
  * Other Info: `style-src includes unsafe-inline.`


Instances: 3

### Solution

Ensure that your web server, application server, load balancer, etc. is properly configured to set the Content-Security-Policy header.

### Reference


* [ https://www.w3.org/TR/CSP/ ](https://www.w3.org/TR/CSP/)
* [ https://caniuse.com/#search=content+security+policy ](https://caniuse.com/#search=content+security+policy)
* [ https://content-security-policy.com/ ](https://content-security-policy.com/)
* [ https://github.com/HtmlUnit/htmlunit-csp ](https://github.com/HtmlUnit/htmlunit-csp)
* [ https://web.dev/articles/csp#resource-options ](https://web.dev/articles/csp#resource-options)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 15

#### Source ID: 3

### [ Sub Resource Integrity Attribute Missing ](https://www.zaproxy.org/docs/alerts/90003/)



##### Medium (High)

### Description

The integrity attribute is missing on a script or link tag served by an external server. The integrity tag prevents an attacker who have gained access to this server from injecting a malicious content.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />`
  * Other Info: ``
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />`
  * Other Info: ``
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;700;900&family=IBM+Plex+Mono:wght@400;500;600&display=swap" />`
  * Other Info: ``


Instances: 3

### Solution

Provide a valid integrity attribute to the tag.

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity ](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Subresource_Integrity)


#### CWE Id: [ 345 ](https://cwe.mitre.org/data/definitions/345.html)


#### WASC Id: 15

#### Source ID: 3

### [ Cross-Origin-Embedder-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Embedder-Policy header is a response header that prevents a document from loading any cross-origin resources that don't explicitly grant the document permission (using CORP or CORS).

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Embedder-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``


Instances: 3

### Solution

Ensure that the application/web server sets the Cross-Origin-Embedder-Policy header appropriately, and that it sets the Cross-Origin-Embedder-Policy header to 'require-corp' for documents.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Embedder-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-embedder-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Cross-Origin-Resource-Policy Header Missing or Invalid ](https://www.zaproxy.org/docs/alerts/90004/)



##### Low (Medium)

### Description

Cross-Origin-Resource-Policy header is an opt-in header designed to counter side-channels attacks like Spectre. Resource should be specifically set as shareable amongst different origins.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/favicon.svg
  * Node Name: `https://gov-agent.ai/favicon.svg`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/robots.txt
  * Node Name: `https://gov-agent.ai/robots.txt`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: `Cross-Origin-Resource-Policy`
  * Attack: ``
  * Evidence: ``
  * Other Info: ``

Instances: Systemic


### Solution

Ensure that the application/web server sets the Cross-Origin-Resource-Policy header appropriately, and that it sets the Cross-Origin-Resource-Policy header to 'same-origin' for all web pages.
'same-site' is considered as less secured and should be avoided.
If resources must be shared, set the header to 'cross-origin'.
If possible, ensure that the end user uses a standards-compliant and modern web browser that supports the Cross-Origin-Resource-Policy header (https://caniuse.com/mdn-http_headers_cross-origin-resource-policy).

### Reference


* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cross-Origin-Embedder-Policy)


#### CWE Id: [ 693 ](https://cwe.mitre.org/data/definitions/693.html)


#### WASC Id: 14

#### Source ID: 3

### [ Timestamp Disclosure - Unix ](https://www.zaproxy.org/docs/alerts/10096/)



##### Low (Low)

### Description

A timestamp was disclosed by the application/web server. - Unix

* URL: https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js
  * Node Name: `https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1508020004`
  * Other Info: `1508020004, which evaluates to: 2017-10-14 22:26:44.`
* URL: https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js
  * Node Name: `https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1606100006`
  * Other Info: `1606100006, which evaluates to: 2020-11-23 02:53:26.`
* URL: https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js
  * Node Name: `https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1608100004`
  * Other Info: `1608100004, which evaluates to: 2020-12-16 06:26:44.`
* URL: https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js
  * Node Name: `https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1615020014`
  * Other Info: `1615020014, which evaluates to: 2021-03-06 08:40:14.`
* URL: https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js
  * Node Name: `https://gov-agent.ai/assets/workItems.compact-BvjL6mJp.js`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `1628220024`
  * Other Info: `1628220024, which evaluates to: 2021-08-06 03:20:24.`

Instances: Systemic


### Solution

Manually confirm that the timestamp data is not sensitive, and that the data cannot be aggregated to disclose exploitable patterns.

### Reference


* [ https://cwe.mitre.org/data/definitions/200.html ](https://cwe.mitre.org/data/definitions/200.html)


#### CWE Id: [ 497 ](https://cwe.mitre.org/data/definitions/497.html)


#### WASC Id: 13

#### Source ID: 3

### [ Information Disclosure - Information in Browser sessionStorage ](https://www.zaproxy.org/docs/alerts/120000/)



##### Informational (High)

### Description

Information was stored in browser sessionStorage.
This is not unusual or necessarily unsafe - this informational alert has been raised to help you get a better understanding of what this app is doing. For more details see the Client tabs - this information was set directly in the browser and will therefore not necessarily appear in this form in any HTTP(S) messages.

* URL: https://gov-agent.ai/%23/login
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: `sentryReplaySession`
  * Attack: ``
  * Evidence: ``
  * Other Info: `The following data (key=value) was set: sentryReplaySession={"id":"d380c34f79ae4adda403111037290649","started":1786461505639,"lastActivity":1786461505723,"segmentId":0,"sampled":"buffer","dirty":false}
Note that this alert will only be raised once for each URL + key.`


Instances: 1

### Solution

This is an informational alert and no action is necessary. 

### Reference



#### CWE Id: [ 359 ](https://cwe.mitre.org/data/definitions/359.html)


#### WASC Id: 13

#### Source ID: 3

### [ Modern Web Application ](https://www.zaproxy.org/docs/alerts/10109/)



##### Informational (Medium)

### Description

The application appears to be a modern web application. If you need to explore it automatically then the Client Spider may well be more effective than the standard one.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="./assets/index-B3ThE2Hw.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="./assets/index-CK6elX9V.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `<script type="module" crossorigin src="./assets/index-B3ThE2Hw.js"></script>`
  * Other Info: `No links have been found while there are scripts, which is an indication that this is a modern web application.`


Instances: 3

### Solution

This is an informational alert and so no changes are required.

### Reference




#### Source ID: 3

### [ Re-examine Cache-control Directives ](https://www.zaproxy.org/docs/alerts/10015/)



##### Informational (Low)

### Description

The cache-control header has not been set properly or is missing, allowing the browser and proxies to cache content. For static assets like css, js, or image files this might be intended, however, the resources should be reviewed to ensure that no sensitive content will be cached.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: `public, max-age=0, must-revalidate`
  * Other Info: ``
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: `public, max-age=0, must-revalidate`
  * Other Info: ``
* URL: https://gov-agent.ai/robots.txt
  * Node Name: `https://gov-agent.ai/robots.txt`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: `public, max-age=0, must-revalidate`
  * Other Info: ``
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: `cache-control`
  * Attack: ``
  * Evidence: `public, max-age=0, must-revalidate`
  * Other Info: ``


Instances: 4

### Solution

For secure content, ensure the cache-control HTTP header is set with "no-cache, no-store, must-revalidate". If an asset should be cached consider setting the directives "public, max-age, immutable".

### Reference


* [ https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching ](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html#web-content-caching)
* [ https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control ](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Cache-Control)
* [ https://grayduck.mn/2021/09/13/cache-control-recommendations/ ](https://grayduck.mn/2021/09/13/cache-control-recommendations/)


#### CWE Id: [ 525 ](https://cwe.mitre.org/data/definitions/525.html)


#### WASC Id: 13

#### Source ID: 3

### [ Storable and Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, and may be retrieved directly from the cache, rather than from the origin server by the caching servers, in response to similar requests from other users. If the response data is sensitive, personal or user-specific, this may result in sensitive information being leaked. In some cases, this may even result in a user gaining complete control of the session of another user, depending on the configuration of the caching components in use in their environment. This is primarily an issue where "shared" caching servers such as "proxy" caches are configured on the local network. This configuration is typically found in corporate or educational environments, for instance.

* URL: https://gov-agent.ai/assets/index-Cg-x7kwR.css
  * Node Name: `https://gov-agent.ai/assets/index-Cg-x7kwR.css`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=31536000`
  * Other Info: ``


Instances: 1

### Solution

Validate that the response does not contain sensitive, personal or user-specific information. If it does, consider the use of the following HTTP response headers, to limit, or prevent the content being stored and retrieved from the cache by another user:
Cache-Control: no-cache, no-store, must-revalidate, private
Pragma: no-cache
Expires: 0
This configuration directs both HTTP 1.0 and HTTP 1.1 compliant caching servers to not store the response, and to not retrieve the response (without validation) from the cache, in response to a similar request.

### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3

### [ Storable but Non-Cacheable Content ](https://www.zaproxy.org/docs/alerts/10049/)



##### Informational (Medium)

### Description

The response contents are storable by caching components such as proxy servers, but will not be retrieved directly from the cache, without validating the request upstream, in response to similar requests from other users.

* URL: https://gov-agent.ai/
  * Node Name: `https://gov-agent.ai/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=0`
  * Other Info: ``
* URL: https://gov-agent.ai/demo/
  * Node Name: `https://gov-agent.ai/demo/`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=0`
  * Other Info: ``
* URL: https://gov-agent.ai/favicon.svg
  * Node Name: `https://gov-agent.ai/favicon.svg`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=0`
  * Other Info: ``
* URL: https://gov-agent.ai/robots.txt
  * Node Name: `https://gov-agent.ai/robots.txt`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=0`
  * Other Info: ``
* URL: https://gov-agent.ai/sitemap.xml
  * Node Name: `https://gov-agent.ai/sitemap.xml`
  * Method: `GET`
  * Parameter: ``
  * Attack: ``
  * Evidence: `max-age=0`
  * Other Info: ``

Instances: Systemic


### Solution



### Reference


* [ https://datatracker.ietf.org/doc/html/rfc7234 ](https://datatracker.ietf.org/doc/html/rfc7234)
* [ https://datatracker.ietf.org/doc/html/rfc7231 ](https://datatracker.ietf.org/doc/html/rfc7231)
* [ https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html ](https://www.w3.org/Protocols/rfc2616/rfc2616-sec13.html)


#### CWE Id: [ 524 ](https://cwe.mitre.org/data/definitions/524.html)


#### WASC Id: 13

#### Source ID: 3


