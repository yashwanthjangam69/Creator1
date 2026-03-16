const client = window.supabase.createClient(
  "https://vhdtlbpmstvnpcikrcwo.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZHRsYnBtc3R2bnBjaWtyY3dvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1NzMyMTAsImV4cCI6MjA4OTE0OTIxMH0.1SwUzf7UAyUslpxIk6x7rXLfa4-naElyNSWtI2Un570",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      storage: window.localStorage
    }
  }
)
