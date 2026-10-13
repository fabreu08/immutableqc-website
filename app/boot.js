// Immutable QC app: the start check (docs/product-v1.md, section 5: JavaScript errors shown as a readable message). A
// small classic script that runs before the app's module (app.mjs). If the module never starts (a browser too old for it,
// or one of the app's files did not load), the page says so in words instead of sitting still, and a folder dropped on it
// is not opened by the browser in place of the page. app.mjs marks <html data-app="ready"> once it has started; from then
// on this file does nothing. Module scripts run before the load event, so at load the app has either started or failed.
(function () {
  'use strict'
  var root = document.documentElement
  var shown = false
  function started() { return root.getAttribute('data-app') === 'ready' }
  function say() {
    if (shown || started()) return
    var p = document.getElementById('boot-error')
    if (!p) return
    shown = true
    var box = document.createElement('span')
    box.className = 'callout callout-fail'
    box.innerHTML = '<svg aria-hidden="true" focusable="false"><use href="#i-x"/></svg><span></span>'
    box.lastChild.textContent = 'The app could not start in this browser, so nothing can be checked here yet. Nothing was uploaded. Reload the page; if this message stays, use a current Chrome, Edge, Firefox or Safari. The agent runs the same audit on the command line: node iqc.mjs audit "<folder>".'
    p.setAttribute('role', 'alert')
    p.replaceChildren(box)
    p.hidden = false
  }
  window.addEventListener('load', function () { if (!started()) say() })
  document.addEventListener('dragover', function (e) { if (!started()) e.preventDefault() })
  document.addEventListener('drop', function (e) { if (!started()) { e.preventDefault(); say() } })
})()
