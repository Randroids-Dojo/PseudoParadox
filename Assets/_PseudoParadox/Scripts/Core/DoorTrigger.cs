using System.Collections;
using UnityEngine;

namespace _PseudoParadox.Scripts.Core
{
    public class DoorTrigger : MonoBehaviour
    {
        public Clock clock;
        public GameObject playerPrefab;
        public PlayerPositionManager playerPositionManager;

        private GameObject playerClone;

        readonly TimeContainer time = new TimeContainer(7, 28, 0);

        private void OnTriggerEnter(Collider other)
        {
            if (!other.CompareTag("Player")) return;
            var startingPosition = new Vector3(0, 0, 0);
            TravelToTime(time, other, startingPosition);
            DestroyPlayerClones();
            StartCoroutine(WaitForClockThenCreateNewClones(0.1f, startingPosition));
        }

        private IEnumerator WaitForClockThenCreateNewClones(float waitTime, Vector3 startingPosition)
        {
            yield return new WaitForSeconds(waitTime);

            CreateNewPlayerClone(startingPosition);
        }

        private void TravelToTime(TimeContainer newTime, Collider other, Vector3 startingPosition)
        {
            other.transform.position = startingPosition;
            playerPositionManager.SaveTimeTravel();
            clock.ChangeTime(newTime);
        }

        private void CreateNewPlayerClone(Vector3 startingPosition)
        {
            playerClone = Instantiate(playerPrefab, startingPosition, new Quaternion(0, 0, 0, 0));
            playerClone.GetComponent<VariantMovement>().instanceNumber = playerPositionManager.currentInstance;
            playerClone.GetComponent<VariantMovement>().clock = clock;
            playerClone.GetComponent<VariantMovement>().playerPositionManager = playerPositionManager;
        }

        private static void DestroyPlayerClones()
        {
            var playerClones = GameObject.FindGameObjectsWithTag("PlayerClone");
            foreach (var clone in playerClones)
            {
                Destroy(clone.gameObject);
            }

            var playerCloneTargets = GameObject.FindGameObjectsWithTag("PlayerCloneTarget");
            foreach (var playerCloneTarget in playerCloneTargets)
            {
                Destroy(playerCloneTarget.gameObject);
            }
        }
    }
}
