import React, { useEffect, useState } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface OcrProgressIndicatorProps {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  startTime?: Date;
  itemsCount?: number;
}

const OcrProgressIndicator: React.FC<OcrProgressIndicatorProps> = ({
  status,
  startTime,
  itemsCount
}) => {
  const [elapsed, setElapsed] = useState(0);
  const [currentStage, setCurrentStage] = useState(0);

  // Average OCR processing time is ~30-36 seconds
  const ESTIMATED_DURATION = 35; // seconds

  const stages = [
    { name: 'Uploading', icon: '📤', duration: 2 },
    { name: 'Extracting text', icon: '📝', duration: 3 },
    { name: 'Analyzing menu', icon: '🤖', duration: 30 },
    { name: 'Done', icon: '✅', duration: 0 }
  ];

  useEffect(() => {
    if (status === 'processing' && startTime) {
      const interval = setInterval(() => {
        const now = new Date();
        const elapsedSeconds = Math.floor((now.getTime() - startTime.getTime()) / 1000);
        setElapsed(elapsedSeconds);

        // Update current stage based on elapsed time
        let cumulativeDuration = 0;
        for (let i = 0; i < stages.length; i++) {
          cumulativeDuration += stages[i].duration;
          if (elapsedSeconds < cumulativeDuration) {
            setCurrentStage(i);
            break;
          }
        }
        if (elapsedSeconds >= ESTIMATED_DURATION) {
          setCurrentStage(stages.length - 1);
        }
      }, 500);

      return () => clearInterval(interval);
    } else if (status === 'completed') {
      setCurrentStage(stages.length - 1);
    }
  }, [status, startTime]);

  const progress = Math.min((elapsed / ESTIMATED_DURATION) * 100, 100);
  const remainingTime = Math.max(0, ESTIMATED_DURATION - elapsed);

  const getStatusInfo = () => {
    switch (status) {
      case 'pending':
        return {
          color: 'bg-yellow-100 border-yellow-300',
          badge: 'bg-yellow-500 text-white',
          message: 'Waiting to start...'
        };
      case 'processing':
        return {
          color: 'bg-blue-50 border-blue-300',
          badge: 'bg-blue-500 text-white',
          message: stages[currentStage]?.name || 'Processing...'
        };
      case 'completed':
        return {
          color: 'bg-green-50 border-green-300',
          badge: 'bg-green-500 text-white',
          message: `Completed! Found ${itemsCount || 0} items`
        };
      case 'failed':
        return {
          color: 'bg-red-50 border-red-300',
          badge: 'bg-red-500 text-white',
          message: 'Processing failed'
        };
      default:
        return {
          color: 'bg-gray-50 border-gray-300',
          badge: 'bg-gray-500 text-white',
          message: 'Unknown status'
        };
    }
  };

  const statusInfo = getStatusInfo();

  return (
    <Card className={`border-2 ${statusInfo.color} transition-all`}>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Status Badge */}
          <div className="flex items-center justify-between">
            <Badge className={`${statusInfo.badge} px-3 py-1`}>
              {status.toUpperCase()}
            </Badge>
            {status === 'processing' && remainingTime > 0 && (
              <span className="text-sm text-gray-600">
                ~{remainingTime}s remaining
              </span>
            )}
          </div>

          {/* Progress Bar */}
          {status === 'processing' && (
            <div className="w-full bg-gray-200 rounded-full h-3 overflow-hidden">
              <div
                className="bg-blue-500 h-full transition-all duration-500 ease-out rounded-full relative"
                style={{ width: `${progress}%` }}
              >
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white to-transparent opacity-30 animate-shimmer"></div>
              </div>
            </div>
          )}

          {/* Stages */}
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const isActive = index === currentStage && status === 'processing';
              const isCompleted = index < currentStage || status === 'completed';
              const isFuture = index > currentStage && status !== 'completed';

              return (
                <div
                  key={index}
                  className={`flex items-center gap-3 p-2 rounded-lg transition-all ${
                    isActive ? 'bg-blue-100 scale-105' : ''
                  } ${isCompleted ? 'opacity-60' : ''} ${isFuture ? 'opacity-30' : ''}`}
                >
                  <div className={`text-2xl ${isActive ? 'animate-pulse' : ''}`}>
                    {stage.icon}
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${isActive ? 'text-blue-700' : 'text-gray-700'}`}>
                      {stage.name}
                    </p>
                    {isActive && status === 'processing' && (
                      <div className="flex gap-1 mt-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce"></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }}></div>
                        <div className="w-2 h-2 bg-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      </div>
                    )}
                  </div>
                  {isCompleted && <span className="text-green-500 text-xl">✓</span>}
                </div>
              );
            })}
          </div>

          {/* Status Message */}
          <div className="text-center pt-2">
            <p className={`text-sm font-medium ${
              status === 'failed' ? 'text-red-600' :
              status === 'completed' ? 'text-green-600' :
              'text-gray-600'
            }`}>
              {statusInfo.message}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};

export default OcrProgressIndicator;
