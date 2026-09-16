const canonicalHostname = 'ai-pirates-game.com';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isCustomDomain = url.hostname === canonicalHostname || url.hostname === `www.${canonicalHostname}`;

    if (isCustomDomain && (url.protocol === 'http:' || url.hostname !== canonicalHostname)) {
      url.protocol = 'https:';
      url.host = canonicalHostname;
      return Response.redirect(url.href, 308);
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
