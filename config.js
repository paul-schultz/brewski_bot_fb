module.exports = {
    FB_PAGE_TOKEN: process.env.FB_PAGE_TOKEN,
    FB_VERIFY_TOKEN: process.env.FB_VERIFY_TOKEN,
    FB_APP_SECRET: process.env.FB_APP_SECRET,
    SERVER_URL: process.env.SERVER_URL,
    GOOGLE_PROJECT_ID: process.env.GOOGLE_PROJECT_ID,
    DF_LANGUAGE_CODE: process.env.DF_LANGUAGE_CODE,
    GOOGLE_CLIENT_EMAIL: process.env.GOOGLE_CLIENT_EMAIL,
    GOOGLE_PRIVATE_KEY: JSON.parse(process.env.GOOGLE_PRIVATE_KEY),
    PG_CONFIG: {
        user: process.env.PG_CONFIG_USER,
        database: process.env.PG_CONFIG_DATABASE,
        password: process.env.PG_CONFIG_PASSWORD,
        host: process.env.PG_CONFIG_HOST,
        port: 5432,
        nax: 10,
        idleTimeoutMillis: 30000
    }
};