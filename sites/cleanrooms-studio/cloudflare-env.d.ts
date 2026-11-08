declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MOBILE_GATEWAY_KEY?: string;
    ADDRESS_LOOKUP_TOKEN?: string;
  }
}
