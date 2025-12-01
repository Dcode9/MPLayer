export default function handler(request, response) {
  // This function runs on Vercel's server
  // It reads the Environment Variables you set in Vercel Settings
  response.status(200).json({
    supabaseUrl: process.env.SUPABASE_URL,
    supabaseKey: process.env.SUPABASE_ANON_KEY 
  });
}
