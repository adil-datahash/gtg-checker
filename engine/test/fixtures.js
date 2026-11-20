export const GTM_STANDARD = `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','GTM-ABC1234');</script>
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-ABC1234"></iframe></noscript>`;
export const GTM_GTG = GTM_STANDARD.replace("'https://www.googletagmanager.com/gtm.js?id='", "'/k9Pm2Qx7/?id='");
export const page = (body) => `<!doctype html><html><head>${body}</head><body>Hello</body></html>`;

