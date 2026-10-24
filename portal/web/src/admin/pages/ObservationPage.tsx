import { Link, useNavigate, useParams } from "react-router-dom";
import { IconBack } from "../../shared/icons";
import { ObservationView } from "../../shared/ObservationView";
import { api, useAuth } from "../ctx";

export default function ObservationPage() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const nav = useNavigate();
  return (
    <div className="stack">
      <div>
        <Link
          to="/observations"
          className="back"
          onClick={(e) => {
            if (window.history.length > 1) {
              e.preventDefault();
              nav(-1);
            }
          }}
        >
          <IconBack size={18} /> Back to observations
        </Link>
      </div>
      <ObservationView api={api} id={id} me={{ id: me.id, name: me.name }} linkPrefix="/observations/" key={id} />
    </div>
  );
}
