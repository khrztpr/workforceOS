import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const recipient = Deno.env.get('TRAINING_DIGEST_RECIPIENT')
const resendKey = Deno.env.get('RESEND_API_KEY')
const digestKey = Deno.env.get('TRAINING_DIGEST_TRIGGER_KEY')
const appUrl = Deno.env.get('WORKFORCEOS_APP_URL') ?? ''

Deno.serve(async (request) => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!recipient || !resendKey || !digestKey) return new Response('Email digest is not configured', { status: 500 })
  if (request.headers.get('x-training-digest-key') !== digestKey) return new Response('Unauthorized', { status: 401 })

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const today = new Date().toISOString().slice(0, 10)
  const { data: existing } = await supabase.from('training_digest_log').select('id').eq('digest_date', today).eq('recipient_group', recipient).maybeSingle()
  if (existing) return Response.json({ sent: false, reason: 'already_sent_today' })

  const { data: trainees, error } = await supabase
    .from('people')
    .select('display_name, department, job_title, workflow_status, training_start_at, organizations(name)')
    .in('workflow_status', ['endorsed_to_training', 'training_scheduled', 'training_in_progress'])
    .order('training_start_at', { ascending: true, nullsFirst: false })
  if (error) return new Response(error.message, { status: 500 })

  const rows = (trainees ?? []).map((trainee: any) => `<tr><td>${trainee.display_name}</td><td>${trainee.organizations?.name ?? '—'}</td><td>${trainee.job_title ?? trainee.department ?? '—'}</td><td>${trainee.training_start_at ? new Date(trainee.training_start_at).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }) : 'To be scheduled'}</td></tr>`).join('')
  const html = `<h2>Training digest — ${today}</h2><p>${trainees?.length ?? 0} trainee(s) currently require Training-team attention.</p><table cellpadding="8" cellspacing="0" border="1"><thead><tr><th>Name</th><th>Organization</th><th>Position / Department</th><th>Training start</th></tr></thead><tbody>${rows || '<tr><td colspan="4">No incoming trainees today.</td></tr>'}</tbody></table>${appUrl ? `<p><a href="${appUrl}">Open WorkforceOS Training Queue</a></p>` : ''}`
  const email = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ from: 'WorkforceOS <onboarding@resend.dev>', to: [recipient], subject: `Training digest: ${trainees?.length ?? 0} incoming trainee(s)`, html }) })
  if (!email.ok) return new Response(await email.text(), { status: 502 })

  await supabase.from('training_digest_log').insert({ digest_date: today, recipient_group: recipient, trainee_count: trainees?.length ?? 0 })
  return Response.json({ sent: true, traineeCount: trainees?.length ?? 0 })
})
