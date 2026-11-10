import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { BarChart3, ChevronDown, FileBarChart, Home, LogOut, Settings, Truck, UsersRound } from 'lucide-react'

export type WorkspaceSection = 'Home Page' | 'Analytics' | 'Employee Directory' | 'Fleet Management' | 'Data & Reports' | 'General Settings' | 'Account Settings'

type Group = { label: string; icon: LucideIcon; children?: WorkspaceSection[]; section?: WorkspaceSection }

const groups: Group[] = [
  { label: 'Home Page', icon: Home, section: 'Home Page' },
  { label: 'Analytics', icon: BarChart3, section: 'Analytics' },
  { label: 'Employee Management', icon: UsersRound, children: ['Employee Directory'] },
  { label: 'Fleet Management', icon: Truck, section: 'Fleet Management' },
  { label: 'Data & Reports', icon: FileBarChart, section: 'Data & Reports' },
  { label: 'Settings', icon: Settings, children: ['General Settings', 'Account Settings'] },
]

export function WorkspaceNav({ active, onSelect, onSignOut }: { active: WorkspaceSection; onSelect: (section: WorkspaceSection) => void; onSignOut: () => void }) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({ 'Employee Management': true })
  return <aside className="flex min-h-screen w-72 shrink-0 flex-col bg-slate-950 px-4 py-5 text-slate-300 shadow-2xl shadow-slate-950/15">
    <div className="flex items-center gap-3 px-3 text-white"><div className="grid size-9 place-items-center rounded-xl bg-sky-500 shadow-lg shadow-sky-500/20"><BarChart3 className="size-5" /></div><span className="text-lg font-bold tracking-tight">Workforce<span className="text-sky-400">OS</span></span></div>
    <p className="mt-10 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-500">Navigation</p>
    <nav className="mt-3 space-y-1" aria-label="Primary navigation">
      {groups.map((group) => {
        const Icon = group.icon; const isGroupActive = group.section === active || group.children?.includes(active); const isExpanded = expanded[group.label]
        if (group.section) return <button key={group.label} onClick={() => onSelect(group.section!)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-all hover:translate-x-0.5 ${isGroupActive ? 'bg-sky-500 text-white shadow-lg shadow-sky-950/20' : 'hover:bg-slate-800 hover:text-white'}`}><Icon className="size-4" />{group.label}</button>
        return <div key={group.label} className="overflow-hidden rounded-xl"><button onClick={() => setExpanded((current) => ({ ...current, [group.label]: !isExpanded }))} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-sm font-semibold transition-all hover:bg-slate-800 hover:text-white ${isGroupActive ? 'text-white' : ''}`}><Icon className={`size-4 ${isGroupActive ? 'text-sky-400' : ''}`} />{group.label}<ChevronDown className={`ml-auto size-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} /></button><div className={`grid transition-[grid-template-rows,opacity] ${isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'}`}><div className="min-h-0"><div className="mb-1 ml-5 border-l border-slate-800 py-1 pl-3">{group.children?.map((section) => <button key={section} onClick={() => onSelect(section)} className={`my-0.5 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm ${active === section ? 'bg-sky-500/15 font-semibold text-sky-300' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}><span className={`size-1.5 rounded-full ${active === section ? 'bg-sky-400' : 'bg-slate-600'}`} />{section === 'Employee Directory' ? 'Employee Directory' : section}</button>)}</div></div></div></div>
      })}
    </nav>
    <div className="mt-auto border-t border-slate-800 pt-4"><button onClick={onSignOut} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition-all hover:bg-rose-500/10 hover:text-rose-300"><LogOut className="size-4" />Sign out</button></div>
  </aside>
}
