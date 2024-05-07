/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  // Optional: Add a railing slash to all paths '/about' -> '/about/'
  // trailingSlash: true,
  // Optional: Change the output directory 'out' -> 'dist'
  // distDir: 'dist',
  images: {
    unoptimized: true
  }
}

export default nextConfig;
