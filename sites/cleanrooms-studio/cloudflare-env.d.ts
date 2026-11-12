declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    MOBILE_GATEWAY_KEY?: string;
    ADDRESS_LOOKUP_TOKEN?: string;
    EXPO_PROJECT_ID?: string;
    EXPO_PUSH_ACCESS_TOKEN?: string;
    PUSH_DISPATCH_KEY?: string;
    CLEANROOMS_TEST_LOGIN?: string;
  }
}
