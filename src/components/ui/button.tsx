import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
const buttonVariants = cva('inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50', { variants: { variant: { default: 'bg-slate-950 text-white hover:bg-slate-800', outline: 'border border-slate-200 bg-white text-slate-800 hover:bg-slate-50', ghost: 'text-slate-700 hover:bg-slate-100' }, size: { default: 'h-11 px-5', sm: 'h-9 px-3.5', lg: 'h-12 px-6 text-base' } }, defaultVariants: { variant: 'default', size: 'default' } })
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>
export function Button({ className, variant, size, ...props }: ButtonProps) { return <button className={cn(buttonVariants({ variant, size }), className)} {...props} /> }
