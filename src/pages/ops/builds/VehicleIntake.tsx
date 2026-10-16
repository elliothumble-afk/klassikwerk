import { useEffect, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Spinner } from '@/components/ui/Spinner'

interface Props {
  buildId: string
  builderId: string
  platformId: string
  customerId: string | null
  vehicleId: string | null
}

interface VehicleFields {
  vin: string
  year: string
  mileage: string
  colour_original: string
}

interface CustomerAddress {
  formatted: string
}

export function VehicleIntake({ buildId, builderId: _builderId, platformId, customerId, vehicleId }: Props) {
  const qc = useQueryClient()

  const { data: vehicle } = useQuery({
    queryKey: ['build-vehicle', vehicleId],
    enabled: Boolean(vehicleId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, vin, year, mileage, colour_original')
        .eq('id', vehicleId!)
        .single()
      if (error) throw error
      return data
    },
  })

  const { data: customer } = useQuery({
    queryKey: ['build-customer-address', customerId],
    enabled: Boolean(customerId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, address')
        .eq('id', customerId!)
        .single()
      if (error) throw error
      return data as { id: string; address: CustomerAddress | null }
    },
  })

  const [fields, setFields] = useState<VehicleFields>({ vin: '', year: '', mileage: '', colour_original: '' })
  const [address, setAddress] = useState<string>('')
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (vehicle) {
      setFields({
        vin: vehicle.vin ?? '',
        year: vehicle.year?.toString() ?? '',
        mileage: vehicle.mileage?.toString() ?? '',
        colour_original: vehicle.colour_original ?? '',
      })
    }
  }, [vehicle])

  useEffect(() => {
    if (customer?.address) {
      const a = customer.address as CustomerAddress | string
      setAddress(typeof a === 'string' ? a : (a?.formatted ?? ''))
    }
  }, [customer])

  const save = useMutation({
    mutationFn: async () => {
      setErr(null)
      if (!customerId) throw new Error('This build has no customer linked.')

      const vehiclePayload = {
        customer_id: customerId,
        platform_id: platformId,
        vin: fields.vin.trim() || null,
        year: fields.year ? Number(fields.year) : null,
        mileage: fields.mileage ? Number(fields.mileage) : null,
        colour_original: fields.colour_original.trim() || null,
      }

      let nextVehicleId = vehicleId
      if (vehicleId) {
        const { error } = await supabase.from('vehicles').update(vehiclePayload).eq('id', vehicleId)
        if (error) throw error
      } else {
        const { data, error } = await supabase
          .from('vehicles')
          .insert(vehiclePayload)
          .select('id')
          .single()
        if (error) throw error
        nextVehicleId = data.id
        const link = await supabase.from('builds').update({ vehicle_id: nextVehicleId }).eq('id', buildId)
        if (link.error) throw link.error
      }

      // Write address onto the customer
      const addressPayload = address.trim() ? { formatted: address.trim() } : null
      const addrUpdate = await supabase
        .from('customers')
        .update({ address: addressPayload })
        .eq('id', customerId)
      if (addrUpdate.error) throw addrUpdate.error
    },
    onSuccess: () => {
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      qc.invalidateQueries({ queryKey: ['build-detail', buildId] })
      qc.invalidateQueries({ queryKey: ['build-vehicle'] })
      qc.invalidateQueries({ queryKey: ['build-customer-address'] })
    },
    onError: (e: Error) => setErr(e.message),
  })

  const input = 'h-9 px-3 w-full rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm'

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium">Vehicle intake</h2>
        <span className="text-xs text-[var(--color-muted)]">Fills contract merge fields</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="VIN">
          <input
            value={fields.vin}
            onChange={e => setFields(f => ({ ...f, vin: e.target.value.toUpperCase() }))}
            placeholder="17-character VIN"
            className={input}
          />
        </Field>
        <Field label="Year">
          <input
            type="number"
            value={fields.year}
            onChange={e => setFields(f => ({ ...f, year: e.target.value }))}
            className={input}
          />
        </Field>
        <Field label="Mileage">
          <input
            type="number"
            value={fields.mileage}
            onChange={e => setFields(f => ({ ...f, mileage: e.target.value }))}
            className={input}
          />
        </Field>
        <Field label="Original colour">
          <input
            value={fields.colour_original}
            onChange={e => setFields(f => ({ ...f, colour_original: e.target.value }))}
            className={input}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Customer address">
          <textarea
            value={address}
            onChange={e => setAddress(e.target.value)}
            rows={2}
            placeholder="Street, City, State ZIP"
            className="w-full px-3 py-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-background)] text-sm resize-y"
          />
        </Field>
      </div>

      {err && <p className="text-xs text-[var(--color-danger)] mt-2">{err}</p>}

      <div className="mt-4">
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending || !customerId}
          className="h-9 px-4 rounded-[var(--radius-sm)] bg-[var(--color-accent)] text-white text-sm inline-flex items-center gap-2 disabled:opacity-50"
        >
          {save.isPending ? <Spinner size={13} /> : <Check size={14} />}
          {save.isPending ? 'Saving…' : saved ? 'Saved' : 'Save vehicle'}
        </button>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[var(--color-muted)] block mb-1">{label}</label>
      {children}
    </div>
  )
}
