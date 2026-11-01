// One address for the site: visits to the old workers.dev address or to www are sent, with
// their path and query, to https://checkcongress.com.
import { defineMiddleware } from "astro:middleware";

export const SITE_ORIGIN = "https://checkcongress.com";

export const onRequest = defineMiddleware((context, next) => {
  const { hostname, pathname, search } = context.url;
  if (hostname.endsWith(".workers.dev") || hostname === "www.checkcongress.com") {
    return context.redirect(`${SITE_ORIGIN}${pathname}${search}`, 301);
  }
  return next();
});
