/** @type {import('next').NextConfig} */
const nextConfig = {
  // start.sh builds/serves the fast production version from `.next-prod`, so it never touches the dev server's `.next`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
};
export default nextConfig;
