using UnityEngine;

public class DoorTrigger : MonoBehaviour
{
    public GameObject clock;
    public TimeContainer time;

    private void OnTriggerStay(Collider other)
    {
       other.transform.position = new Vector3(0, 0, 0);
       clock.GetComponent<Clock>().ChangeTime(time);
    }
}
