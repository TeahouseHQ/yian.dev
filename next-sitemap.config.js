/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: "https://www.yian.dev",
  generateRobotsTxt: true,
  robotsTxtOptions: {
    policies: [{ userAgent: "*", allow: "/" }],
  },
  // Exclude any paths you don't want indexed
  // exclude: ['/admin/*', '/private/*'],
};
