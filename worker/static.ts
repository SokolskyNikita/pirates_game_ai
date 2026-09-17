/** Canonical redirects and static assets only. No calculation endpoint. */
interface Env { ASSETS: { fetch(request: Request): Promise<Response> } }
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (['ai-pirates-game.com', 'www.ai-pirates-game.com'].includes(url.hostname) &&
        (url.protocol !== 'https:' || url.hostname !== 'ai-pirates-game.com')) {
      url.protocol = 'https:';
      url.hostname = 'ai-pirates-game.com';
      return Response.redirect(url.href, 308);
    }
    return env.ASSETS.fetch(request);
  },
};
