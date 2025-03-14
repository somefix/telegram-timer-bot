import { Entity, Column, PrimaryColumn } from 'typeorm';

@Entity('timers')
export class TimerEntity {
  @PrimaryColumn()
  id: string;

  @Column('timestamp with time zone')
  eventDate: Date;

  @Column('bigint')
  chatId: number;

  @Column('integer', { nullable: true })
  pinnedMessageId: number | null;

  @Column('boolean', { default: true })
  isRunning: boolean;
} 