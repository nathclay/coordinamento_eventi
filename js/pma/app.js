console.log("app.js loaded");
// 1. Connect to Supabase
const supabaseUrl = 'https://xjiikczjmsxnatqjtiik.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhqaWlrY3pqbXN4bmF0cWp0aWlrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMjQ5NjYsImV4cCI6MjA4OTgwMDk2Nn0.1GaWJJWo3VQUlOZEW9IqZr2mKmhX-6l_ZyBNpfovbkw'

// Create client
const { createClient } = window.supabase
const db = createClient(supabaseUrl, supabaseKey)

async function testInsert() {
  // Debug: check the client was created correctly
  console.log('Supabase client:', db)
  console.log('Testing connection...')

  const { data, error } = await db
    .from('interventi')
    .insert([{ squadra: 'ASM 4', attivo: true }])
    .select()

  if (error) {
    console.error('ERROR:', error)
    console.error('Error details:', JSON.stringify(error, null, 2))
  } else {
    console.log('SUCCESS:', data)
  }
}

testInsert()

async function rawTest() {
  const response = await fetch(
    'https://xjiikczjmsxnatqjtiik.supabase.co/rest/v1/interventi',
    {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify({ squadra: 'ASM 7', attivo: true })
    }
  )
  console.log('Status:', response.status)
  const text = await response.text()
  console.log('Response:', text)
}

rawTest()

