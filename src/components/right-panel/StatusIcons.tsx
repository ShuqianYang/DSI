import { Check, X, LoaderCircle, AlertTriangle, Circle } from 'lucide-react';

interface StatusIconProps {
  status: string;
}

export function SubTaskStatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case 'running':
      return <LoaderCircle className="w-3.5 h-3.5 text-[#FFAA00] animate-spin" />;
    case 'completed':
      return <Check className="w-3.5 h-3.5 text-[#44FF44]" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-[#FF4444]" />;
    default:
      return <Circle className="w-3.5 h-3.5 text-[#8888AA]" />;
  }
}

export function EventStatusIcon({ status }: StatusIconProps) {
  switch (status) {
    case 'success':
      return <Check className="w-4 h-4 mt-0.5 text-[#44FF44]" />;
    case 'partial':
      return <AlertTriangle className="w-4 h-4 mt-0.5 text-[#FFAA00]" />;
    case 'failed':
      return <X className="w-4 h-4 mt-0.5 text-[#FF4444]" />;
    default:
      return <AlertTriangle className="w-4 h-4 mt-0.5 text-[#8888AA]" />;
  }
}
