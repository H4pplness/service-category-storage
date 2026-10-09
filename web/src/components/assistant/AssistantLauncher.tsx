// Nút nổi mở ô chat trợ lý Mindmate (Drawer bên phải, không che thao tác trên màn hình chính).
import { useState } from 'react';
import { Drawer, FloatButton } from 'antd';
import { MessageCircleQuestion } from 'lucide-react';
import AssistantPanel from './AssistantPanel';
import './assistant.css';

export default function AssistantLauncher() {
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      {!open && (
        <FloatButton
          type="primary"
          className="mm-launcher"
          icon={<MessageCircleQuestion size={20} strokeWidth={1.9} />}
          tooltip="Hỏi trợ lý Sản phẩm - Nghiệp vụ"
          onClick={() => setOpen(true)}
        />
      )}
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        width={expanded ? 'min(960px, 100vw)' : 'min(500px, 100vw)'}
        mask={false}
        keyboard={false}
        closable={false}
        title={null}
        rootClassName="mm-drawer"
        styles={{ body: { padding: 0 } }}
      >
        <AssistantPanel expanded={expanded} onToggleExpand={() => setExpanded((v) => !v)} onClose={() => setOpen(false)} />
      </Drawer>
    </>
  );
}
