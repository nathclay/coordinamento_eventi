// js/supabase.js
const SUPABASE_URL  = 'https://xjiikczjmsxnatqjtiik.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqaWlrY3pqbXN4bmF0cWp0aWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjQ5NjYsImV4cCI6MjA4OTgwMDk2Nn0.1GaWJJWo3VQUlOZEW9IqZr2mKmhX-6l_ZyBNpfovbkw';

// window.supabase is set by the CDN script loaded before this file
const db = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
